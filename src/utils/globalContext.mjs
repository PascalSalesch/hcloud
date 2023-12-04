/**
 * @file This file contains variables that are available when items without dependencies are being created.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

import parseConfigString from '../utils/parseConfigString.mjs'
import * as stringUtils from './stringUtils.mjs'

/**
 * @typedef {object} GlobalContextParams
 * @property {string} [hcloudYAML] - The path to the configuration `hcloud.yml` file.
 * @property {string} [input=process.cwd()] - The folder where the `hcloud.yml` file is located.
 * @property {string} [output=process.cwd()] - The folder where the output files are written to.
 * @property {string} [cwd=process.cwd()] - The current working directory.
 */

/**
 * @typedef {object} ServerDetails
 * @property {string} id - The ID of the server.
 * @property {string} image - The image of the server.
 * @property {string} ipv4_address - The IPv4 address of the server.
 * @property {string} ipv6_address - The IPv6 address of the server.
 * @property {string} location - The location of the server.
 * @property {string} name - The name of the server.
 * @property {string} server_type - The server type of the server.
 * @property {string[]} ssh_keys - The SSH keys of the server.
 * @property {string[]} services - The services of the server.
 * @property {string[]} ports - The ports of the server.
 * @property {string[]} environment - The environment variables of the server.
 * @property {string[]} volumes - The volumes of the server.
 */

/**
 * @typedef {object} GlobalContext
 * @property {string} input - The folder where the `hcloud.yml` file is located.
 * @property {string} output - The folder where the output files are written to.
 * @property {string} stateFolder - The folder where the artifacts of `create_server_config` are located.
 * @property {string} cwd - The current working directory.
 * @property {object} env - The environment variables.
 * @property {(filename: string) => string} file - Reads the content of a file.
 * @property {import('../classes/Server.mjs').default[]} servers - The servers to consider.
 * @property {import('../classes/Volume.mjs').default[]} volumes - The volumes to consider.
 * @property {import('../classes/SSHKey.mjs').default[]} sshKeys - The ssh-keys to consider.
 * @property {{[key: string]: ServerDetails}} serverDetailsMapping - The state of the servers.
 */

/**
 * Mutates the context object by adding the properties required to make a global context.
 * @param {GlobalContextParams} [ctx={}] - The root directory.
 * @param {object} [options={}] - Flags and options.
 * @param {boolean} [options.requireState=false] - If true, the terraform state file must exist.
 * @returns {Promise<GlobalContext>} The global context.
 */
export default async function getGlobalContext (ctx = {}, options = {}) {
  // Validate the input
  ctx.cwd = ctx.cwd || process.cwd()
  ctx.output = ctx.output || path.resolve(ctx.cwd, 'dist')
  ctx.hcloudYAML = ctx.hcloudYAML ? (path.isAbsolute(ctx.hcloudYAML) ? ctx.hcloudYAML : path.resolve(ctx.cwd, ...ctx.hcloudYAML.split('/'))) : path.resolve(ctx.cwd, 'hcloud.yml')
  ctx.stateFolder = ctx.stateFolder ? (path.isAbsolute(ctx.stateFolder) ? ctx.stateFolder : path.resolve(ctx.cwd, ...ctx.stateFolder.split('/'))) : ctx.output
  ctx.tfState = path.resolve(ctx.stateFolder, 'terraform.tfstate')
  ctx.input = path.dirname(ctx.hcloudYAML)
  ctx.env = process.env

  // validate and parse the hcloud.yaml and terraform.tfstate input files.
  if (!(fs.existsSync(ctx.hcloudYAML))) throw new Error(`The configuration file "${ctx.hcloudYAML}" does not exist.`)
  const configString = await fs.promises.readFile(ctx.hcloudYAML, { encoding: 'utf-8' })
  Object.assign(ctx, { ...parseConfigString(configString), ...ctx })
  if (!(fs.existsSync(ctx.output))) await fs.promises.mkdir(ctx.output, { recursive: true })

  // bind methods to the context
  Object.assign(ctx, Object.entries(stringUtils).reduce((stringUtils, [name, method]) => {
    stringUtils[name] = method.bind(null, ctx)
    return stringUtils
  }, {}), ctx)

  // require state
  ctx.serverDetailsMapping = (options.requireState) ? await getServerDetailsMapping(ctx) : null

  return ctx
}

/**
 * Gets the state of the servers.
 * @param {import('./globalContext.mjs').GlobalContextParams} ctx - The global context.
 * @param {object} ctx.stateFolder - The path to the folder containing the artifacts of `create_server_config`.
 * @returns {Promise<{[key: string]: ServerDetails}>} The state of the servers.
 * @throws {Error} - If the terraform state file does not exist.
 */
async function getServerDetailsMapping (ctx) {
  // Validate the terraform.tfstate input file.
  if (!(fs.existsSync(ctx.tfState))) throw new Error(`The terraform state file "${ctx.tfState}" does not exist.`)
  const terraformState = JSON.parse(await fs.promises.readFile(ctx.tfState, { encoding: 'utf-8' }))

  // Create the server details mapping.
  const serverDetailsMapping = ctx.servers.reduce((mapping, server) => {
    const resourceName = stringUtils.resource(ctx, server.name)
    const serverInstances = terraformState.resources?.find(resource => resource.name === resourceName)
    if (!serverInstances) throw new Error(`Could not find server "${server.name}" with resource name "${resourceName}".`)
    const serverInstance = serverInstances.instances.find(instance => instance.attributes.name === server.name)
    if (!serverInstance) throw new Error(`Could not find server "${server.name}" with instance name "${server.name}".`)
    const serverInstanceAttributes = serverInstance.attributes
    mapping[server.name] = Object.assign(server.toObject(), serverInstanceAttributes)
    return mapping
  }, {})

  return serverDetailsMapping
}
