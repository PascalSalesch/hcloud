#!/usr/bin/env node

/**
 * @file Entry point for the CLI.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as url from 'node:url'
import * as util from 'node:util'

import * as commonCommandErrors from './utils/commonCommandErrors.mjs'

// Define file system paths.
const __filename = url.fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const __root = path.resolve(__dirname, '..')
const __init = path.resolve(process.argv[1])

const commandsFolder = path.resolve(__dirname, 'commands')

// If this file is the entry point of the program, run the main function.
if (__filename === __init || __root === __init) {
  process.nextTick(() => hcloud(...process.argv.slice(2)))
}

/**
 * Entry point for the CLI.
 * @param {string} commandName - The configuration in YAML format.
 * @param {string[]} cliArgs - The configuration in YAML format.
 * @returns {Promise<any>} The return value of the given command.
 */
export default async function hcloud (commandName, ...cliArgs) {
  if (!commandName) { await help(); return }
  try {
    const command = {
      name: commandName,
      file: path.resolve(commandsFolder, ...commandName.split('/').slice(0, -1), `${commandName.split('/').pop()}.mjs`)
    }
    if (!(command.file.startsWith(commandsFolder))) {
      throw new Error(`The command "${command.name}" has not been implemented, yet.`)
    }

    // Import the command module.
    command.main = (await import(command.file)).default
    if (typeof command.main !== 'function') return await commonCommandErrors.throwInvalidDefaultExportErr(command)

    const args = util.parseArgs({ args: cliArgs, strict: false })
    if (args.values?.help) return await commonCommandErrors.throwMismatchPositionalErr(command, args, true)
    if (args.positionals.length !== command.main.length) return await commonCommandErrors.throwMismatchPositionalErr(command, args)
    await command.main(...args.positionals, args.values)
  } catch (err) {
    console.error(err)
    process.exit(1)
  }
}

/**
 * Prints the help message.
 */
async function help () {
  const commands = []
  for (const command of fs.readdirSync(commandsFolder)) {
    const file = path.resolve(commandsFolder, command)
    const name = command.slice(0, -4)
    const node = await new Promise((resolve) => {
      commonCommandErrors.parseCommandFile(file, {
        enter (node) {
          if (node.type === 'ExportDefaultDeclaration') resolve(node)
        }
      })
    })
    const description = node.declaration?.jsdoc?.text?.split('\n').filter(line => {
      if (line.startsWith(' * @')) return false
      if (line === '*\n') return false
      return true
    }).map(line => line.slice(2).trim()).join(' ').trim()
    commands.push({ name, description })
  }

  console.log('Usage: npm -s start -- <command> [options]')
  console.log('')
  console.log('Commands:')
  for (const command of commands) {
    console.log(`  ${command.name} - ${command.description}`)
  }
  console.log('')
  console.log('Options:')
  console.log('  --help - Show this help message.')
  process.exit(0)
}
