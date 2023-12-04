#!/usr/bin/env node

/**
 * @file Entry point for the "create_server_config" command.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as url from 'node:url'
import * as util from 'node:util'

import * as stringUtils from '../utils/stringUtils.mjs'
import exec from '../utils/exec.mjs'
import parse from '../utils/parse.mjs'
import maskSensitiveAttributes from '../utils/maskSensitiveAttributes.mjs'
import getGlobalContext from '../utils/globalContext.mjs'

// Define file system paths.
const __filename = url.fileURLToPath(import.meta.url)
const __init = path.resolve(process.argv[1])

// Define contents
const content = `
terraform {
  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "1.44.1"
    }
  }
}

variable "HCLOUD_TOKEN" {
  description = "The API token for Hetzner Cloud"
  type        = string
}

provider "hcloud" {
  token = var.HCLOUD_TOKEN
}
`

const volumeAttachementContent = `
resource "hcloud_volume_attachment" "\${resource(server.name)}_\${resource(volume.name)}" {
  server_id = hcloud_server.\${resource(server.name)}.id
  volume_id = hcloud_volume.\${resource(volume.name)}.id

  \${connection}

  provisioner "remote-exec" {
    inline = [
      "mkdir -p \${volume.path}",
      "mount \\\${hcloud_volume.\${resource(volume.name)}.linux_device} \${volume.path}"
    ]
  }
}
`

// If this file is the entry point of the program, run the main function.
if (__filename === __init) {
  process.nextTick(async () => {
    const cli = util.parseArgs({ strict: false })
    await createServerConfigFromHCloudYML(...cli.positionals, cli.values)
  })
}

/**
 * Creates the server config.
 * @param {string} hcloudYAML - The path to the configuration `hcloud.yml` file.
 * @param {object} [options={}] - Flags and options.
 * @param {string} [options.output] - The folder where the output files are written to.
 * @param {boolean} [options.dryRun=false] - If true, the output files are not applied.
 * @param {boolean} [options.mask=true] - If false, the sensitive attributes in the Terraform state are not masked.
 * @param {boolean} [options.destroyOnErrors=true] - If true, the cluster is destroyed if there are errors.
 * @throws {Error} - If the configuration file does not exist.
 */
export default async function createServerConfigFromHCloudYML (hcloudYAML, options = {}) {
  console.log('Begin creating server config.')

  // Validate the options.
  const isDryRunEnabled = options.dryRun === true
  const isMaskingEnabled = options.mask !== false
  const isDestroyOnErrorEnabled = options.destroyOnErrors !== false
  if (isDryRunEnabled) console.log('Dry run enabled.')
  if (isMaskingEnabled) console.log('Masking sensitive attributes enabled.')
  if (isDestroyOnErrorEnabled) console.log('Destroying server cluster on errors enabled.')

  // Create the context
  const ctx = await getGlobalContext({ hcloudYAML }, { requireState: false })
  console.log(`Input "hcloud.yaml" file: "${ctx.hcloudYAML}".`)
  console.log(`Output directory: "${ctx.output}".`)
  console.log(`Found ${ctx.servers.length} server${ctx.servers.length === 1 ? '' : 's'} in the configuration file.`)
  console.log(`Found ${ctx.sshKeys.length} ssh-key${ctx.sshKeys.length === 1 ? '' : 's'} in the configuration file.`)
  console.log(`Found ${ctx.volumes.length} volume${ctx.volumes.length === 1 ? '' : 's'} in the configuration file.`)
  await clean(ctx.output, { recursive: false, extensions: ['.tf'] })

  // copy hcloud.yml to output
  await fs.promises.copyFile(ctx.hcloudYAML, path.resolve(ctx.output, 'hcloud.yml'))

  // write providers.tf
  await fs.promises.writeFile(path.resolve(ctx.output, 'hcloud_provider.tf'), stringUtils.trimLine(ctx, content), { encoding: 'utf-8' })

  // Create the terraform config for resources that only need the global context.
  const promises = [
    ...ctx.sshKeys.map(sshKey => async () => {
      console.log(`Writing ssh-key "${sshKey.name}".`)
      await sshKey.write(ctx)
      console.log(`Finished writing ssh-key "${sshKey.name}".`)
    }),
    ...ctx.servers.map(server => async () => {
      console.log(`Writing server "${server.name}".`)
      server.write(ctx)
      console.log(`Finished writing server "${server.name}".`)
    })
  ]
  await Promise.all(promises.map(promise => promise()))

  // Create the terraform config for resources that are intertwined.
  promises.length = 0
  promises.push(...ctx.volumes.map(volume => async () => {
    console.log(`Writing volume "${volume.name}".`)
    const servers = ctx.servers.filter(server => server.volumes && server.volumes.includes(volume.name))
    if (servers.length === 0) throw new Error(`The volume "${volume.name}" is not attached to any server.`)
    if (servers.length > 1) throw new Error(`The volume "${volume.name}" is attached to multiple servers.`)
    const server = servers[0]
    await volume.write(ctx, server)
    console.log(`Finished writing volume "${volume.name}" of server "${server.name}".`)
  }))
  await Promise.all(promises.map(promise => promise()))
  console.log('Writing volume attachments.')
  await writeHCloudVolumeAttachments(ctx)
  console.log('Finished creating server config.')

  // Apply the output files.
  if (!(isDryRunEnabled)) await apply(ctx, { isDestroyOnErrorEnabled })

  // Mask sensitive attributes to store the tfstate as an artifact.
  if (isMaskingEnabled) await mask(ctx)
}

/**
 * Applies the server config.
 * @param {import('../utils/globalContext.mjs').GlobalContext} ctx - The global context.
 * @param {object} [options={}] - Flags and options.
 * @param {boolean} [options.isDestroyOnErrorEnabled=true] - If true, the cluster is destroyed if there are errors.
 * @throws {Error} - If the command fails.
 */
async function apply (ctx, options = {}) {
  console.log('Begin applying server config.')
  const commands = [
    'terraform init',
    'terraform apply -auto-approve'
  ]

  const cmdOptions = {
    stdio: 'inherit',
    cwd: ctx.output,
    env: {
      ...process.env,
      TF_VAR_HCLOUD_TOKEN: process.env.TF_VAR_HCLOUD_TOKEN || process.env.HCLOUD_TOKEN
    }
  }

  for (const command of commands) {
    console.log(`Running command "${command}".`)
    const output = await exec(command, cmdOptions)
    if (output.stdout.trim()) console.log(output.stdout)
    if (output.stderr.trim()) console.warn(output.stderr)
    if (output.exitCode) {
      if (options.isDestroyOnErrorEnabled) {
        console.log('Destroying server config.')
        await exec('terraform destroy -auto-approve', cmdOptions)
        console.log('Finished destroying server config.')
      }
      throw new Error(`Command "${command}" failed.`)
    }
  }
}

/**
 * Masks sensitive attributes in the terraform state.
 * @param {import('../utils/globalContext.mjs').GlobalContext} ctx - The global context.
 * @throws {Error} - If the terraform state file does not exist.
 */
async function mask (ctx) {
  const tfStateFile = path.resolve(ctx.output, 'terraform.tfstate')
  if (fs.existsSync(tfStateFile)) {
    console.log('Masking sensitive attributes.')
    const terraformState = JSON.parse(await fs.promises.readFile(tfStateFile, { encoding: 'utf-8' }))
    const maskedTerraformState = maskSensitiveAttributes(terraformState)
    await fs.promises.writeFile(tfStateFile, JSON.stringify(maskedTerraformState, null, 2), { encoding: 'utf-8' })
    console.log('Finished masking sensitive attributes.')
  } else {
    console.log('Could not find terraform state file. Skipping masking sensitive attributes.')
  }
}

/**
 * Cleans a directory.
 * @param {string} directory - The directory to clean.
 * @param {object} [options={}] - Flags and options.
 * @param {boolean} [options.recursive=true] - If true, the directory is cleaned recursively.
 * @param {string[]} [options.extensions] - The extensions of files to consider.
 */
async function clean (directory, options = {}) {
  for (const dirent of await fs.promises.readdir(directory, { withFileTypes: true })) {
    const direntPath = path.resolve(directory, dirent.name)
    if (dirent.isDirectory()) {
      if (options.recursive !== false) await clean(direntPath, options)
      const files = await fs.promises.readdir(direntPath)
      if (files.length === 0) await fs.promises.rmdir(direntPath)
    } else {
      if (options.extensions && options.extensions.length > 0) {
        const extension = path.extname(direntPath)
        if (!(options.extensions.includes(extension))) continue
      }
      await fs.promises.unlink(direntPath)
    }
  }
}

/**
 * Writes the terraform config for the volume attachments.
 * @param {import('../utils/globalContext.mjs').GlobalContext} ctx - The global context.
 */
async function writeHCloudVolumeAttachments (ctx) {
  const attachedVolumes = []

  for (const server of ctx.servers) {
    if (!server.volumes || server.volumes.length === 0) continue
    for (const volumeName of server.volumes) {
      const volume = ctx.volumes.find(volume => volume.name === volumeName)
      if (!volume) throw new Error(`Could not find volume "${volumeName}"`)

      const privateSSHKeyName = server.getSSHKeys(ctx, { private: true })[0]
      const privateSSHKey = ctx.sshKeys.find(sshKey => sshKey.name === privateSSHKeyName)
      if (!privateSSHKey) throw new Error(`Could not find ssh-key "${privateSSHKeyName}"`)

      const connection = await privateSSHKey.getConnection(ctx, {
        host: `hcloud_server.${stringUtils.resource(ctx, server.name)}.ipv4_address`,
        intendation: 2
      })

      const context = { ...ctx, server, volume, connection }
      const output = path.resolve(ctx.output, `hcloud_volume_attachment_${server.name}_${volume.name}.tf`)
      const tfConfig = stringUtils.trimLine(ctx, await parse(context, volumeAttachementContent))
      await fs.promises.writeFile(output, tfConfig, { encoding: 'utf-8' })

      if (!(attachedVolumes.includes(volumeName))) attachedVolumes.push(volumeName)
    }
  }

  // throw an error if there are volumes that are not attached to any server
  const unattachedVolumes = ctx.volumes.filter(volume => !(attachedVolumes.includes(volume.name)))
  if (unattachedVolumes.length > 0) {
    throw new Error(`The following volumes are not attached to any server:\n - "${unattachedVolumes.map(volume => volume.name).join('"\n - "')}"`)
  }
}
