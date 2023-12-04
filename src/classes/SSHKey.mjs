/**
 * @file SSHKey class.
 * This class is used to validate the configuration. It is not used to form any relationships between resources.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

import parser from '../utils/parse.mjs'
import * as stringUtils from '../utils/stringUtils.mjs'

// Define contents
const content = `
variable "sensitive_\${resource(this.name)}_public_key" {
  description = "The value of the Hetzner Cloud API token"
  default     = <<EOF
\${publicKey}
EOF
  sensitive = true
}

resource "hcloud_ssh_key" "\${resource(this.name)}" {
  name       = "\${this.name}"
  public_key = var.sensitive_\${resource(this.name)}_public_key
}
`

const connectionContent = `
connection {
  type        = "ssh"
  user        = "\${this.user}"
  private_key = file("\\\${path.module}/.ssh/\${this.name}")
  host        = \${host}
}
`

const sshConfigContent = `
Host \${host}
  User \${this.user}
  StrictHostKeyChecking no
  UserKnownHostsFile=/dev/null
  IdentityFile ~/.ssh/\${this.name}
`

/**
 * Represents SSH credentials.
 */
export default class SSHKey {
  /**
   * The list of SSH keys.
   * @type {SSHKey[]}
   */
  static #instances = []

  /**
   * Implements the iterator protocol.
   * @returns {Array<SSHKey>} The iterator.
   */
  static [Symbol.iterator] () {
    return this.#instances[Symbol.iterator]()
  }

  /**
   * Finds an SSH key.
   * @param {...any} args - Arguments to pass to the find function.
   * @returns {SSHKey} The SSH key.
   */
  static find (...args) {
    return [...this.#instances].find(...args)
  }

  /**
   * The name of the SSH key.
   * @type {string}
   */
  #name = null

  set name (value) {
    if (typeof value !== 'string') throw new TypeError(`Expected string, got ${typeof value} in ssh-key name "${value}"`)
    this.#name = value
  }

  get name () {
    return this.#name
  }

  /**
   * The private key for SSH authentication.
   * @type {string}
   */
  #privateKey = null

  set privateKey (value) {
    if (this.#privateKey !== null) throw new Error('Private key already set')
    if (typeof value !== 'string') throw new TypeError(`Expected string, got ${typeof value} in "${this.name}" ssh-key private key "${value}"`)
    this.#privateKey = value
  }

  get privateKey () {
    return this.#privateKey
  }

  /**
   * The public key for SSH authentication.
   * @type {string}
   */
  #publicKey = null

  set publicKey (value) {
    if (this.#publicKey !== null) throw new Error('Public key already set')
    if (typeof value !== 'string') throw new TypeError(`Expected string, got ${typeof value} in "${this.name}" ssh-key public key "${value}"`)
    this.#publicKey = value
  }

  get publicKey () {
    return this.#publicKey
  }

  /**
   * The user associated with the SSH key.
   * @type {string}
   */
  #user = 'root'

  set user (value) {
    if (typeof value !== 'string') throw new TypeError(`Expected string, got ${typeof value} in "${this.name}" ssh-key user "${value}"`)
    this.#user = value
  }

  get user () {
    return this.#user
  }

  /**
   * Creates a new SSH key.
   * @param {string} name - The name of the SSH key.
   * @param {object} options - Flags and options.
   * @param {string} options.private_key - The private key for SSH authentication.
   * @param {string} [options.public_key] - The public key for SSH authentication.
   * @param {string} [options.user=root] - The user associated with the SSH key.
   */
  constructor (name, options = {}) {
    this.name = name
    this.user = options.user || 'root'
    if (options.private_key) this.privateKey = options.private_key
    if (options.public_key) this.publicKey = options.public_key

    if (!(this.#privateKey || this.#publicKey)) {
      throw new Error(`Either private_key or public_key must be set in ssh-key "${this.name}"`)
    }

    SSHKey.#instances.push(this)
  }

  /**
   * Writes the SSH key to the output directory.
   * @param {import('../utils/globalContext.mjs').GlobalContext} ctx - The global context.
   */
  async write (ctx) {
    const parse = parser.bind(this)

    // .ssh directory
    const sshPath = path.resolve(ctx.output, '.ssh')
    if (!(fs.existsSync(sshPath))) fs.mkdirSync(sshPath, { recursive: true })
    fs.chmodSync(sshPath, 0o700)

    // private key
    if (this.privateKey) {
      fs.writeFileSync(path.resolve(sshPath, this.name), await parse(ctx, this.privateKey), { encoding: 'utf-8' })
      fs.chmodSync(path.resolve(sshPath, this.name), 0o600)
    }

    // public key
    if (this.publicKey) {
      const publicKey = await parse(ctx, this.publicKey)
      fs.writeFileSync(path.resolve(sshPath, `${this.name}.pub`), publicKey, { encoding: 'utf-8' })
      fs.chmodSync(path.resolve(sshPath, `${this.name}.pub`), 0o644)

      // terraform
      const context = { ...ctx, publicKey }
      const tfConfig = stringUtils.trimLine(ctx, await parse(context, content))
      fs.writeFileSync(path.resolve(ctx.output, `hcloud_ssh_key_${this.name}.tf`), tfConfig, { encoding: 'utf-8' })
    }
  }

  /**
   * Returns the connection string for the SSH key.
   * @param {import('../utils/globalContext.mjs').GlobalContext} ctx - The global context.
   * @param {object} [options={}] - Flags and options.
   * @param {string} [options.host="self.ipv4_address"] - The host to connect to.
   * @param {string} [options.intendation=0] - The intendation of the connection string.
   * @returns {Promise<string>} The connection string.
   */
  async getConnection (ctx, options = {}) {
    if (!(this.privateKey)) return null
    const connection = await parser.call(this, { host: options.host || 'self.ipv4_address' }, connectionContent)
    return connection.replace(/\n/g, `\n${' '.repeat(options.intendation || 0)}`)
  }

  /**
   * Returns the SSH config for the SSH key.
   * @param {string} host - The host to connect to.
   * @returns {Promise<string>} The SSH config.
   */
  getSSHConfig (host) {
    if (!(this.privateKey)) return null
    return parser.call(this, { host }, sshConfigContent)
  }
}
