/**
 * @file Server class.
 * This class is used to validate the configuration. It is not used to form any relationships between resources.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as url from 'node:url'

import * as stringUtils from '../utils/stringUtils.mjs'
import parser from '../utils/parse.mjs'
import exec from '../utils/exec.mjs'

import SSHKey from './SSHKey.mjs'

// Define file system paths.
const __filename = url.fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const __root = path.resolve(__dirname, '..', '..')

// Define contents
const content = `
resource "hcloud_server" "\${resource(this.name)}" {
  name        = "\${this.name}"
  server_type = "\${this.serverType}"
  image       = "debian-12"
  location    = "\${this.location}"
  user_data   = file("./hcloud_server/cloud-init.yml")
  ssh_keys    = [\${this.getSSHKeys(ctx, { public: true }).map(name => \`hcloud_ssh_key.\${resource(name)}.id\`).join(', ')}]

  public_net {
    ipv4_enabled = true
    ipv6_enabled = true
  }
}
`

/**
 * Represents a Hetzner Cloud server.
 */
export default class Server {
  /**
   * The list of servers.
   * @type {Server[]}
   */
  static #instances = []

  /**
   * Implements the iterator protocol.
   * @returns {Array<Server>} The iterator.
   */
  static [Symbol.iterator] () {
    return this.#instances[Symbol.iterator]()
  }

  /**
   * Finds a server.
   * @param {...any} args - Arguments to pass to the find function.
   * @returns {Server} The server.
   */
  static find (...args) {
    return [...this.#instances].find(...args)
  }

  /**
   * The name of the server.
   * @type {string}
   */
  #name = null

  set name (value) {
    if (typeof value !== 'string') throw new TypeError(`Expected string, got ${typeof value} in Server name "${value}"`)
    if (!value.match(/^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/)) throw new Error(`Invalid server name "${value}". A server name must be a valid hostname.`)
    this.#name = value
  }

  get name () {
    return this.#name
  }

  /**
   * The type of the server.
   * @type {string}
   */
  #serverType = null

  set serverType (value) {
    if (typeof value !== 'string') throw new TypeError(`Expected string, got ${typeof value} in "${this.name}" Server type "${value}"`)
    this.#serverType = value
  }

  get serverType () {
    return this.#serverType
  }

  /**
   * The location of the server.
   * @type {string}
   */
  #location = null

  set location (value) {
    if (typeof value !== 'string') throw new TypeError(`Expected string, got ${typeof value} in "${this.name}" Server location "${value}"`)
    this.#location = value
  }

  get location () {
    return this.#location
  }

  /**
   * The names of SSH keys to add to the server.
   * @type {string[]}
   */
  #sshKeys = null

  set sshKeys (value) {
    if (this.#sshKeys !== null) throw new Error('SSH keys already set')
    if (!Array.isArray(value)) throw new TypeError(`Expected array, got ${typeof value} in "${this.name}" Server SSH keys "${value}"`)
    if (value.length === 0) throw new Error('SSH keys must not be empty')
    this.#sshKeys = value
  }

  get sshKeys () {
    return [...this.#sshKeys]
  }

  /**
   * The names of services to run on the server.
   * @type {string[]}
   */
  #services = null

  set services (value) {
    if (this.#services !== null) throw new Error('Services already set')
    if (!Array.isArray(value)) throw new TypeError(`Expected array, got ${typeof value} in "${this.name}" Server services "${value}"`)
    if (value.length === 0) throw new Error('Services must not be empty')
    this.#services = value
  }

  get services () {
    return [...this.#services]
  }

  /**
   * The names of volumes to attach to the server.
   * @type {string[]}
   */
  #volumes = null

  set volumes (value) {
    if (this.#volumes !== null) throw new Error('Volumes already set')
    if (!Array.isArray(value)) throw new TypeError(`Expected array, got ${typeof value} in "${this.name}" Server volumes "${value}"`)
    this.#volumes = value
  }

  get volumes () {
    return [...this.#volumes]
  }

  /**
   * The ports to open on the server.
   * @type {number[]}
   */
  #ports = null

  set ports (value) {
    if (this.#ports !== null) throw new Error('Ports already set')
    if (!Array.isArray(value)) throw new TypeError(`Expected array, got ${typeof value} in "${this.name}" Server ports "${value}"`)
    this.#ports = value
  }

  get ports () {
    return [...this.#ports]
  }

  /**
   * The environment variables to set on the server.
   */
  #environment = null

  set environment (value) {
    if (this.#environment !== null) throw new Error('Environment already set')
    if (typeof value !== 'object') throw new TypeError(`Expected object, got ${typeof value} in "${this.name}" Server environment "${value}"`)
    if (value === null) throw new TypeError(`Expected object, got null in Server environment "${value}"`)
    this.#environment = value
  }

  get environment () {
    return this.#environment
  }

  /**
   * Creates a new server.
   * @param {string} name - The name of the server.
   * @param {object} options - The server options.
   * @param {string} options.server_type - The type of the server.
   * @param {string} options.location - The location of the server.
   * @param {string[]} [options.ssh_keys] - The names of SSH keys to add to the server.
   * @param {string[]} [options.services] - The names of services to run on the server.
   * @param {string[]} [options.volumes] - The names of volumes to attach to the server.
   * @param {number[]} [options.ports] - The ports to open on the server.
   * @param {object} [options.environment={}] - The environment variables to set on the server.
   */
  constructor (name, options) {
    this.name = name
    this.serverType = options.server_type
    this.sshKeys = options.ssh_keys
    this.services = options.services
    this.location = options.location || ''
    this.ports = options.ports || []
    this.environment = options.environment || {}
    this.volumes = options.volumes || []

    Server.#instances.push(this)
  }

  /**
   * Returns the object representation of the server.
   * @returns {object} The object representation of the server.
   */
  toObject () {
    return {
      name: this.name,
      server_type: this.serverType,
      ssh_keys: this.sshKeys,
      services: this.services,
      location: this.location,
      ports: this.ports,
      environment: this.environment,
      volumes: this.volumes
    }
  }

  /**
   * Writes the server to the output directory.
   * @param {import('../utils/globalContext.mjs').GlobalContext} ctx - The global context.
   */
  async write (ctx) {
    const parse = parser.bind(this)

    // copy cloud-init.yml
    const serverPath = path.resolve(ctx.output, 'hcloud_server')
    if (!(fs.existsSync(serverPath))) fs.mkdirSync(serverPath, { recursive: true })
    await fs.promises.copyFile(path.resolve(__root, 'cloud-init.yml'), path.resolve(serverPath, 'cloud-init.yml'))

    const output = path.resolve(ctx.output, `hcloud_server_${this.name}.tf`)
    const tfConfig = stringUtils.trimLine(ctx, await parse(ctx, content))

    await fs.promises.writeFile(output, tfConfig, { encoding: 'utf-8' })
  }

  /**
   * Returns the names of the SSH keys to add to the server.
   * @param {import('../utils/globalContext.mjs').GlobalContext} ctx - The global context.
   * @param {object} [options={}] - The options.
   * @param {boolean} [options.private=true] - Whether to include private keys. `true` unless `options.public` is set.
   * @param {boolean} [options.public=true] - Whether to include public keys. `true` unless `options.private` is set.
   * @returns {string[]} The names of the SSH keys to add to the server.
   */
  getSSHKeys (ctx, options = {}) {
    const sshKeys = []
    for (const sshKey of SSHKey) {
      if (this.sshKeys.includes(sshKey.name)) {
        if (options.private && sshKey.privateKey) sshKeys.push(sshKey.name)
        else if (options.public && sshKey.publicKey) sshKeys.push(sshKey.name)
        else if (!options.private && !options.public) sshKeys.push(sshKey.name)
      }
    }
    return sshKeys
  }

  /**
   * Uploads the whole `hcloud_server/${server.name}` folder to the server.
   * @param {import('../utils/globalContext.mjs').GlobalContext} ctx - The global context.
   * @param {object} [options] - Flags and options.
   * @param {boolean} [options.force=false] - If true, warnings are ignored.
   * @returns {Promise<{file: string, user: string, ip: string}>} The SSH key file, the user and the IP address of the server.
   */
  async upload (ctx, options = {}) {
    const src = path.resolve(ctx.output, 'hcloud_server', this.name)
    const dest = '/root/'
    const sshKeyNames = this.getSSHKeys(ctx, { private: true })
    if (sshKeyNames.length < 1) throw new Error(`Could not find any private SSH key for server "${this.name}".`)
    const sshKey = SSHKey.find((sshKey) => sshKeyNames.includes(sshKey.name) && sshKey.user)
    const sshKeyFile = path.resolve(ctx.stateFolder, '.ssh', sshKey.name)
    const scp = `scp -i ${path.relative(process.cwd(), sshKeyFile)} -o "StrictHostKeyChecking=no"`
    const serverDetails = ctx.serverDetailsMapping[this.name]
    if (!serverDetails) throw new Error(`Could not find server details for server "${this.name}".`)

    const upload = async (src, dest) => {
      for (const dirent of await fs.promises.readdir(src, { withFileTypes: true })) {
        const srcPath = path.resolve(src, dirent.name)
        const destPath = path.resolve(dest, dirent.name)
        if (dirent.isDirectory()) {
          await upload(srcPath, destPath)
        } else {
          const cmd = `${scp} ${path.relative(process.cwd(), srcPath)} ${sshKey.user}@${serverDetails.ipv4_address}:${destPath}`
          console.log(`$ ${cmd}`)
          const output = await exec(cmd, { cwd: process.cwd(), timeout: 10000 })
          if (output.stdout.trim()) console.log('> ' + output.stdout.replaceAll('\n', '\n> '))
          if (output.exitCode) {
            console.warn('> ' + output.stderr.replaceAll('\n', '\n> '))
            if (!options.force) throw new Error(`Execution of "${cmd}" failed.`)
          }
        }
      }
    }
    await upload(src, dest)

    return {
      file: sshKeyFile,
      user: sshKey.user,
      ip: serverDetails.ipv4_address
    }
  }
}
