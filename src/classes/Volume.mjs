/**
 * @file Volume class.
 * This class is used to validate the configuration. It is not used to form any relationships between resources.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

import * as stringUtils from '../utils/stringUtils.mjs'
import parser from '../utils/parse.mjs'

// Define contents
const content = `
resource "hcloud_volume" "\${resource(this.name)}" {
  name     = "\${this.name}"
  size     = \${this.size}
  location = "\${server.location}"
  format   = "ext4"
}
`

/**
 * Represents a volume configuration.
 */
export default class Volume {
  /**
   * The list of volumes.
   * @type {Volume[]}
   */
  static #instances = []

  /**
   * Implements the iterator protocol.
   * @returns {Array<Volume>} The iterator.
   */
  static [Symbol.iterator] () {
    return this.#instances[Symbol.iterator]()
  }

  /**
   * The name of the volume.
   * @type {string}
   */
  #name = null

  set name (value) {
    if (typeof value !== 'string') throw new TypeError(`Expected string, got ${typeof value} in Volume name "${value}"`)
    this.#name = value
  }

  get name () {
    return this.#name
  }

  /**
   * The size of the volume in gigabytes.
   * @type {number}
   */
  #size = null

  set size (value) {
    if (this.#size !== null) throw new Error('Size already set')
    if (typeof value !== 'number') throw new TypeError(`Expected number, got ${typeof value} in "${this.name}" Volume size "${value}"`)
    this.#size = value
  }

  get size () {
    return this.#size
  }

  /**
   * The path where the volume should be mounted.
   * @type {string}
   */
  #path = null

  set path (value) {
    if (this.#path !== null) throw new Error('Path already set')
    if (typeof value !== 'string') throw new TypeError(`Expected string, got ${typeof value} in "${this.name}" Volume path "${value}"`)
    this.#path = value
  }

  get path () {
    return this.#path
  }

  /**
   * Creates a new volume.
   * @param {string} name - The name of the volume.
   * @param {object} options - Additional options.
   * @param {number} options.size - The size of the volume in gigabytes.
   * @param {string} options.path - The path where the volume should be mounted.
   */
  constructor (name, options = {}) {
    this.name = name
    this.size = options.size
    this.path = options.path

    if (!(this.#size)) throw new Error(`The volume "${this.name}" does not have a size.`)
  }

  /**
   * Writes the volume configuration to a file.
   * @param {import('../utils/globalContext.mjs').GlobalContext} ctx - The global context.
   * @param {import('../classes/Server.mjs').default} server - The server to which the volume should be attached.
   */
  async write (ctx, server) {
    const parse = parser.bind(this)
    const output = path.resolve(ctx.output, `hcloud_volume_${this.name}.tf`)
    const context = { ...ctx, server }
    const tfConfig = stringUtils.trimLine(ctx, await parse(context, content))
    await fs.promises.writeFile(output, tfConfig, { encoding: 'utf-8' })
  }
}
