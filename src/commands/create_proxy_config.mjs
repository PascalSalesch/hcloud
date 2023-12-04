#!/usr/bin/env node

/**
 * @file Entry point for the "create_proxy_config" command.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as url from 'node:url'
import * as util from 'node:util'

import getGlobalContext from '../utils/globalContext.mjs'
import * as stringUtils from '../utils/stringUtils.mjs'
import exec from '../utils/exec.mjs'
import parser from '../utils/parse.mjs'

import Service from '../classes/Service.mjs'
import Server from '../classes/Server.mjs'
import SSHKey from '../classes/SSHKey.mjs'

// Define file system paths.
const __filename = url.fileURLToPath(import.meta.url)
const __init = path.resolve(process.argv[1])

// Define contents
const upstreamContent = `
upstream \${upstream.name} {
  \${upstream.serverlist.join('\\n  ')}
  \${upstream.loadBalancer};
}
`

const serverContent = `
server {
  listen \${host.proxyPort};
  server_name \${host.host};
  \${serverLocationContents.join('\\n  ')}
}
`

const serverLocationContent = `
location \${host.path || '/'} {
  proxy_pass http://\${host.upstream};
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
`

// If this file is the entry point of the program, run the main function.
if (__filename === __init) {
  process.nextTick(async () => {
    const cli = util.parseArgs({ strict: false })
    await createNginXConfig(...cli.positionals, cli.values)
  })
}

/**
 * Creates a `nginx.conf` file from a `terraform.tfstate` and a `hcloud.yml` file.
 * @param {string} hcloudYAML - The path to the configuration `hcloud.yml` file.
 * @param {string} stateFolder - The path to the folder containing the artifacts of `create_server_config`.
 * @param {object} [options={}] - Flags and options.
 * @param {string} [options.output] - The folder where the output files are written to.
 * @param {boolean} [options.dryRun=false] - If true, the nginx.conf file is not applied, just created.
 * @param {boolean} [options.force=false] - If true, warnings are ignored.
 * @throws {Error} - If the configuration file does not exist.
 */
export default async function createNginXConfig (hcloudYAML, stateFolder, options = {}) {
  console.log('Begin creating "nginx.conf" file.')

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

  // each image represents an nginx upstream
  // one upstream can have multiple servers
  // create a map of upstreams to servers and servers to upstreams
  const upstreamMap = {}
  const serverUpstreamMap = {}
  for (const [serverName, serverDetails] of Object.entries(ctx.serverDetailsMapping)) {
    const server = ctx.servers.find(server => server.name === serverName)
    const images = (await Promise.all(Service.filter(service => server.services.includes(service.name)).map(service => service.getImages(ctx, server)))).flat()
    for (const image of images) {
      for (const port of image.ports) {
        // only add nginx configs for proxies
        if (!port.proxyPort) continue

        const upstreamName = stringUtils.hostname(ctx, `${image.name}-${port.container}`)
        upstreamMap[upstreamName] = upstreamMap[upstreamName] || {}
        upstreamMap[upstreamName].name = upstreamName
        upstreamMap[upstreamName].servers = upstreamMap[upstreamName].servers || []
        upstreamMap[upstreamName].servers.push({
          name: image.name,
          host: serverDetails.ipv4_address,
          port: port.host,
          proxyPort: port.proxyPort || port.container,
          image: {
            name: image.image,
            port: port.container,
            path: port.details?.path || '/',
            host: port.details?.host || serverDetails.ipv4_address
          }
        })
        upstreamMap[upstreamName].loadBalancer = upstreamMap[upstreamName].loadBalancer || port.details?.schema

        // map to server
        serverUpstreamMap[serverName] = serverUpstreamMap[serverName] || []
        if (!serverUpstreamMap[serverName].includes(upstreamName)) serverUpstreamMap[serverName].push(upstreamName)
      }
    }
  }
  console.log(`Found ${Object.keys(upstreamMap).length} upstream${Object.keys(upstreamMap).length === 1 ? '' : 's'} in the configuration file.`)

  // retrieve all host ports and set default load balancer
  for (const upstream of Object.values(upstreamMap)) {
    upstream.loadBalancer = upstream.loadBalancer || 'least_conn'
    for (const upstreamServer of upstream.servers) {
      if (upstreamServer.port) continue
      console.log(`Retrieving host port for image "${upstreamServer.image.name}" on server "${upstreamServer.host}".`)
      if (isDryRunEnabled) {
        console.log('Skipping host port retrieval in dry-run mode.')
        upstreamServer.port = String(Math.floor(Math.random() * 10000) + 10000)
        continue
      }

      const serverName = Object.values(ctx.serverDetailsMapping).find(server => server.ipv4_address === upstreamServer.host).name
      const server = Server.find((server) => server.name === serverName)
      const sshKeyNames = server.getSSHKeys(ctx, { private: true })
      if (sshKeyNames.length < 1) throw new Error(`Could not find any private SSH key for server "${server.name}".`)
      const sshKey = SSHKey.find((sshKey) => sshKeyNames.includes(sshKey.name) && sshKey.user)
      const sshKeyFile = path.resolve(ctx.stateFolder, '.ssh', sshKey.name)
      const ssh = `ssh -i ${sshKeyFile} -o "StrictHostKeyChecking=no" ${sshKey.user}@${upstreamServer.host}`
      const command = `${ssh} docker-compose port ${upstreamServer.name} ${upstreamServer.image.port}`
      console.log(`$ ${command}`)
      const output = await exec(command)
      if (output.exitCode) {
        console.warn(output.stderr)
        throw new Error(`Execution of "${command}" failed.`)
      }
      upstreamServer.port = output.stdout.split(':')[1].trim()
      console.log(`Found host port "${upstreamServer.port}" for image "${upstreamServer.image.name}" on server "${upstreamServer.host}".`)
    }
  }

  console.log('Creating nginx.conf file.')
  for (const [serverName, upstreamNames] of Object.entries(serverUpstreamMap)) {
    const serverDetails = ctx.serverDetailsMapping[serverName]
    const upstreams = upstreamNames.map(upstreamName => upstreamMap[upstreamName])
    await createNginXConfForServer(ctx, serverDetails, upstreams, { isForceEnabled })
  }

  const serversWithoutUpstreams = ctx.servers.filter(server => !Object.keys(serverUpstreamMap).includes(server.name))
  console.log(`Disabling nginx for ${serversWithoutUpstreams.length} server${serversWithoutUpstreams.length === 1 ? '' : 's'} without upstreams.`)
  for (const server of serversWithoutUpstreams) {
    const output = path.resolve(ctx.output, 'hcloud_server', server.name, 'nginx.conf')
    if (fs.existsSync(output)) fs.unlinkSync(output)
  }

  if (!isDryRunEnabled) {
    // disable nginx on servers without upstreams
    for (const server of serversWithoutUpstreams) {
      console.log(`Disabling nginx on server "${server.name}".`)
      const ssh = await server.upload(ctx, options)
      ssh.cmd = `ssh -i ${ssh.file} -o "StrictHostKeyChecking=no" ${ssh.user}@${ssh.ip}`
      const commands = [
        `${ssh.cmd} "cd /root/ && rm -f /etc/nginx/sites-enabled/default"`,
        `${ssh.cmd} "cd /root/ && nginx -s reload"`
      ]
      for (const command of commands) {
        console.log(`$ ${command}`)
        const output = await exec(command)
        if (output.stdout.trim()) console.log(output.stdout)
        if (output.stderr.trim()) console.warn(output.stderr)
        if (output.exitCode && isForceEnabled) throw new Error(`Execution of "${command}" failed.`)
      }
    }

    console.log('Uploading and applying nginx.conf file.')
    for (const serverName of Object.keys(serverUpstreamMap)) {
      console.log(`Uploading and applying nginx.conf file for server "${serverName}".`)
      const server = Server.find((server) => server.name === serverName)
      const ssh = await server.upload(ctx, options)
      ssh.cmd = `ssh -i ${ssh.file} -o "StrictHostKeyChecking=no" ${ssh.user}@${ssh.ip}`
      const commands = [
        `${ssh.cmd} "cd /root/ && cp nginx.conf /etc/nginx/sites-enabled/default"`,
        `${ssh.cmd} "cd /root/ && nginx -s reload"`
      ]
      for (const command of commands) {
        console.log(`$ ${command}`)
        const output = await exec(command)
        if (output.stdout.trim()) console.log(output.stdout)
        if (output.stderr.trim()) console.warn(output.stderr)
        if (output.exitCode && isForceEnabled) throw new Error(`Execution of "${command}" failed.`)
      }
    }
  }
}

/**
 * @typedef {object} upstream
 * @property {string} name - The name of the upstream.
 * @property {object[]} servers - The servers of the upstream.
 * @property {string} servers[].host - The host of the server.
 * @property {string} servers[].loadBalancer - The load balancer of the server.
 * @property {string} servers[].port - The port of the container.
 * @property {string} servers[].proxyPort - The port nginx listens on.
 * @property {object} servers[].image - The image of the server.
 * @property {string} servers[].image.name - The name of the image.
 * @property {string} servers[].image.port - The port of the image.
 * @property {string} servers[].image.path - The path of the image.
 * @property {string} servers[].image.host - The host of the image.
 * @property {string[]} [serverlist] - The list of servers in the upstream.
 * @property {string} [content] - The content of the upstream.
 */

/**
 * Creates a `nginx.conf` file for a server.
 * @param {import('../utils/globalContext.mjs').GlobalContext} ctx - The global context.
 * @param {import('../utils/globalContext.mjs').ServerDetails} serverDetails - The details of the server.
 * @param {upstream[]} upstreams - The upstreams to be used by the server.
 * @param {object} [options={}] - Flags and options.
 * @param {boolean} [options.isForceEnabled=false] - If true, warnings are ignored.
 */
async function createNginXConfForServer (ctx, serverDetails, upstreams, options) {
  const output = path.resolve(ctx.output, 'hcloud_server', serverDetails.name, 'nginx.conf')
  console.log(`Writing nginx.conf file for server "${serverDetails.name}".`)
  console.log(`Output file: "${output}".`)
  const hosts = {}
  for (const upstream of upstreams) {
    upstream.serverlist = upstream.servers.map(server => `server ${server.host}:${server.port} max_fails=3 fail_timeout=30s;`)
    const context = { ...ctx, server: serverDetails, upstream, upstreams }
    upstream.content = await parser(context, upstreamContent)

    const serverInfo = upstream.servers.find(server => server.host === serverDetails.ipv4_address)
    const host = serverInfo.image.host || serverDetails.ipv4_address
    const hostName = `${host}:${serverInfo.proxyPort}`
    hosts[hostName] = hosts[hostName] || []
    hosts[hostName].push({
      host,
      port: serverInfo.port,
      proxyPort: serverInfo.proxyPort,
      path: serverInfo.image.path,
      upstream: upstream.name
    })
  }

  // check if there are any server conflicts
  for (const hostsMap of Object.values(hosts)) {
    const paths = {}
    for (const host of hostsMap) {
      const path = host.path
      paths[path] = paths[path] || []
      paths[path].push(host)
      if (paths[path].length > 1) {
        const err = `Server "${serverDetails.name}" has multiple services on the same host:port/location: "${host.host}:${host.proxyPort}${host.path}".`
        if (!options.isForceEnabled) {
          console.log('Use the --force flag to ignore this warning.')
          throw new Error(err)
        } else {
          console.warn(new Error(err))
        }
      }
    }
  }

  // create upstream blocks and server blocks
  const serverUpstreamsContent = Object.values(upstreams).map(upstream => upstream.content).join('\n')
  const serverContents = await Promise.all(Object.values(hosts).map(async (hosts) => {
    const serverLocationContents = (await Promise.all(hosts.map(host => parser({ ...ctx, host }, serverLocationContent)))).map(content => {
      return content.replace(/\n/g, '\n  ')
    })
    const host = { host: hosts[0].host, port: hosts[0].port, proxyPort: hosts[0].proxyPort }
    return parser({ ...ctx, host, serverLocationContents }, serverContent)
  }))

  // create nginx.conf file
  if (!fs.existsSync(path.dirname(output))) fs.mkdirSync(path.dirname(output), { recursive: true })
  const nginxConfContent = `${serverUpstreamsContent}\n${serverContents.join('\n')}`
  await fs.promises.writeFile(output, stringUtils.trimLine(ctx, nginxConfContent))
  console.log(`Wrote nginx.conf file for server "${serverDetails.name}".`)
}
