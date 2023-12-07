#!/usr/bin/env node

/**
 * @file Entry point for the "create_service_config" command.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as url from 'node:url'
import * as util from 'node:util'

import * as stringUtils from '../utils/stringUtils.mjs'
import getGlobalContext from '../utils/globalContext.mjs'
import parser from '../utils/parse.mjs'
import exec from '../utils/exec.mjs'

import Service from '../classes/Service.mjs'

// Define file system paths.
const __filename = url.fileURLToPath(import.meta.url)
const __init = path.resolve(process.argv[1])

// Define contents
const content = `
version: '3'
services:
  \${services}
`

// If this file is the entry point of the program, run the main function.
if (__filename === __init) {
  process.nextTick(async () => {
    const cli = util.parseArgs({ strict: false })
    await createDockerComposeFromTfState(...cli.positionals, cli.values)
  })
}

/**
 * Creates a `docker-compose.yml` file from a `terraform.tfstate` and a `hcloud.yml` file.
 * @param {string} hcloudYAML - The path to the configuration `hcloud.yml` file.
 * @param {string} stateFolder - The path to the folder containing the artifacts of `create_server_config`.
 * @param {object} [options={}] - Flags and options.
 * @param {string} [options.output] - The folder where the output files are written to.
 * @param {boolean} [options.dryRun=false] - If true, the docker-compose.yml file is not applied, just created.
 * @param {boolean} [options.force=false] - If true, warnings are ignored.
 * @throws {Error} - If the configuration file does not exist.
 */
export default async function createDockerComposeFromTfState (hcloudYAML, stateFolder, options = {}) {
  console.log('Begin creating "docker-compose.yml" file.')

  // Output the options
  const isDryRunEnabled = options.dryRun
  const isForceEnabled = options.force
  if (isDryRunEnabled) console.log('Running in dry-run mode.')
  if (isForceEnabled) console.log('Running in force mode.')

  // Create the context
  const ctx = await getGlobalContext({ hcloudYAML, stateFolder }, { requireState: true })
  console.log(`Input "hcloud.yaml" file: "${ctx.hcloudYAML}".`)
  console.log(`Input "terraform.tfstate" file: "${ctx.tfState}".`)
  console.log(`Output directory: "${ctx.output}".`)
  console.log(`Found ${ctx.servers.length} server${ctx.servers.length === 1 ? '' : 's'} in the configuration file.`)

  // Create the docker-compose.yml file for each server.
  await Promise.all(ctx.servers.map(server => createDockerFile(ctx, ctx.serverDetailsMapping[server.name])))

  // Upload and apply
  if (!isDryRunEnabled) {
    await Promise.all(ctx.servers.map(server => uploadAndApply(ctx, server, options)))
  }
}

/**
 * Uploads the whole `hcloud_server/${server.name}` folder to the server and invokes the apps.
 * @param {import('../utils/globalContext.mjs').GlobalContextParams} ctx - The global context.
 * @param {import('../classes/Server.mjs').default} server - The server.
 * @param {object} [options] - Flags and options.
 * @param {boolean} [options.force=false] - If true, warnings are ignored.
 */
async function uploadAndApply (ctx, server, options = {}) {
  const ssh = await server.upload(ctx, options)
  ssh.cmd = `ssh -i ${path.relative(process.cwd(), ssh.file)} -o "StrictHostKeyChecking=no" ${ssh.user}@${ssh.ip}`
  const env = { ...process.env, ...server.environment }

  // login to the GitHub Container Registry
  if (ctx.ghcr[server.name]) {
    console.log(`Logging in to the GitHub Container Registry on server "${server.name}".`)
    env.token = env.GITHUB_TOKEN ? await parser({ ...ctx }, env.GITHUB_TOKEN) : process.env.GITHUB_TOKEN
    env.actor = env.GITHUB_ACTOR ? await parser({ ...ctx }, env.GITHUB_ACTOR) : process.env.GITHUB_ACTOR
    const cmd = `docker login ghcr.io -u ${env.actor || 'github-actions'} --password-stdin"`
    const cmdFull = `${ssh.cmd} "echo ${env.token} | ${cmd}`
    console.log(`$ ${cmd}`)
    const output = await exec(cmdFull)
    if (output.stdout.trim()) console.log(output.stdout)
    if (output.stderr.trim()) console.warn(output.stderr)
    if (output.exitCode && !options.force) throw new Error(`Execution of "${cmd}" failed.`)
  }

  // wait for docker-compose to be installed on the server
  const timeout = setTimeout(() => { console.log(`Waiting for docker-compose to be installed on server "${server.name}".`) }, 2000)
  const waitCmd = `${ssh.cmd} "while ! docker-compose --version; do sleep 1; done"`
  await exec(waitCmd, { stdio: 'inherit' })
  clearTimeout(timeout)

  // apply the docker-compose.yml file
  const cmd = `${ssh.cmd} "cd /root/ && docker-compose up -d"`
  console.log(`$ ${cmd}`)
  const output = await exec(cmd, { env })
  if (output.stdout.trim()) console.log(output.stdout)
  if (output.stderr.trim()) console.warn(output.stderr)
  if (output.exitCode && !options.force) throw new Error(`Execution of "${cmd}" failed.`)
  console.log(`Applied "docker-compose.yml" file to server "${server.name}".`)
  console.log('')
}

/**
 * Creates a `docker-compose.yml` file from a `terraform.tfstate` and a `hcloud.yml` file.
 * @param {import('../utils/globalContext.mjs').GlobalContextParams} ctx - The global context.
 * @param {object} serverDetails - The server details.
 * @param {string} serverDetails.name - The name of the server.
 * @param {string} serverDetails.ipv4_address - The IPv4 address of the server.
 */
async function createDockerFile (ctx, serverDetails) {
  const output = path.resolve(ctx.output, 'hcloud_server', serverDetails.name)
  if (!(fs.existsSync(output))) await fs.promises.mkdir(output, { recursive: true })

  // find the services
  const serviceNames = serverDetails.services
  const services = Service.filter(service => serviceNames.includes(service.name))

  // get the images for the services
  const s = services.length === 1 ? '' : 's'
  console.log(`Retrieving images of ${services.length} service${s} for server "${serverDetails.name}".`)
  const images = (await Promise.all(services.map(service => service.getImages(ctx, serverDetails)))).flat()

  // throw an error if the same host port is used twice
  for (const port of images.map(({ ports }) => ports.map(({ host }) => host)).flat()) {
    if (!port) continue
    const imagesOnPort = images.filter(({ ports }) => ports.map(({ host }) => host).includes(port))
    if (imagesOnPort.length > 1) {
      const imageNames = imagesOnPort.map(({ name }) => name).join('\n- ')
      throw new Error(`The host port "${port}" is used by multiple images on server "${serverDetails.name}":\n- ${imageNames}`)
    }
  }

  // check if the images are from the GitHub Container Registry
  ctx.ghcr = ctx.ghcr || {}
  const hasGitHubContainerRegistryImages = images.some((image) => image.url.includes('ghcr.io'))
  if (hasGitHubContainerRegistryImages) ctx.ghcr[serverDetails.name] = true

  // create the docker-compose.yml file
  const serviceString = images.map(({ content }) => content.replaceAll('\n', '\n  ')).join('\n\n  ')
  const dockerComposeContent = stringUtils.trimLine(ctx, await parser({ ...ctx, services: serviceString }, content))
  const outputPath = path.resolve(output, 'docker-compose.yml')
  await fs.promises.writeFile(outputPath, dockerComposeContent)
  console.log(`Wrote "docker-compose.yml" file to "${outputPath}".`)
}
