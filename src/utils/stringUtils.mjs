/**
 * @file Utility functions to format strings.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * Removes empty lines, unless they are preceded by a closing curly brace. ALways adds a trailing newline.
 * @param {import('./globalContext.mjs').GlobalContextParams} ctx - The global context.
 * @param {string} str - The string to clean up.
 * @returns {string} The cleaned up string.
 */
export function trimLine (ctx, str) {
  return str.split('\n').filter((line, i, a) => {
    if (i !== a.length - 1 && a[i - 1] && a[i - 1].startsWith('}')) return true
    if (line.trim()) return true
    return false
  }).join('\n') + '\n'
}

/**
 * Retrieves the content of a file.
 * @param {import('./globalContext.mjs').GlobalContextParams} ctx - The global context.
 * @param {string} filepath - The path to the file.
 * @returns {string} The content of the file.
 * @throws {Error} - If the file does not exist.
 */
export function file (ctx, filepath) {
  if (path.isAbsolute(filepath)) return fs.readFileSync(filepath, { encoding: 'utf-8' })
  for (const dir of [ctx.input, ctx.cwd]) {
    const absoluteFilepath = path.resolve(dir, ...filepath.split('/'))
    if (fs.existsSync(absoluteFilepath)) return fs.readFileSync(absoluteFilepath, { encoding: 'utf-8' })
  }
  throw new Error(`The file "${filepath}" does not exist.`)
}

/**
 * Converts a string to a valid hostname by replacing all non-alphanumeric characters with dashes.
 * @param {import('./globalContext.mjs').GlobalContextParams} ctx - The global context.
 * @param {string} hostname - The hostname.
 * @returns {string} The hostname.
 */
export function hostname (ctx, hostname) {
  hostname = hostname.replace(/[^a-zA-Z0-9]/gi, '-')
  hostname = hostname.replace(/--+/g, '-')
  while (hostname.startsWith('-')) hostname = hostname.slice(1)
  while (hostname.endsWith('-')) hostname = hostname.slice(0, -1)
  return hostname.toLowerCase()
}

/**
 * Converts a string to a valid terraform resource name by replacing all non-alphanumeric characters with underscores.
 * @param {import('./globalContext.mjs').GlobalContextParams} ctx - The global context.
 * @param {string} name - The resource name.
 * @returns {string} The resource name.
 */
export function resource (ctx, name) {
  name = name.replace(/[^a-zA-Z0-9]/gi, '_')
  name = name.replace(/__+/g, '_')
  while (name.startsWith('_')) name = name.slice(1)
  while (name.endsWith('_')) name = name.slice(0, -1)
  return name.toLowerCase()
}
