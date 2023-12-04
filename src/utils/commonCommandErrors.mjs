/**
 * @file This utility parses a command file.
 */

import * as fs from 'node:fs'

import * as acorn from 'acorn'
import estraverse from 'estraverse'

/**
 * @typedef {object} Command
 * @property {string} name - The name of the command.
 * @property {string} file - The file path of the command.
 * @property {Function} main - The main function of the command.
 */

/**
 * Throws an error if the default export of a command module is invalid.
 * @param {Command} command - The command that is being executed.
 */
export async function throwInvalidDefaultExportErr (command) {
  const defaultExportLocation = await new Promise((resolve, reject) => {
    const loc = { found: false }
    parseCommandFile(command.file, {
      enter (node) {
        if (node.type === 'ExportDefaultDeclaration') {
          Object.assign(loc, node.loc, { found: true })
        }
      }
    }).then(() => resolve(loc)).catch(reject)
  })
  if (defaultExportLocation.found === false) throw new Error(`The command "${command.name}" does not provide a default export.`)
  throw new Error([
    'The default export must be a function.',
    `in ${command.name} file://${command.file}:${defaultExportLocation.start.line}:${defaultExportLocation.start.column}`
  ].join('\n    '))
}

/**
 * Throws an error if the number of positional arguments does not match the number of parameters of the default export.
 * @param {Command} command - The command that is being executed.
 * @param {object} args - The parsed CLI arguments.
 * @param {boolean} help - Whether the help flag has been set.
 */
export async function throwMismatchPositionalErr (command, args, help = false) {
  const defaultExport = await new Promise((resolve, reject) => {
    parseCommandFile(command.file, {
      enter (node) {
        if (node.type === 'ExportDefaultDeclaration') resolve(node)
      }
    })
  })

  const s = command.main.length === 1 ? '' : 's'
  const errMsg = `Expected ${command.main.length} positional argument${s}. Received ${args.positionals.length} instead.`
  const errMsgLine = `in ${command.name} file://${command.file}:${defaultExport.loc.start.line}:${defaultExport.loc.start.column}`
  const jsdoc = defaultExport.declaration?.jsdoc?.text
  if (!(jsdoc)) throw new Error(`${errMsg}\n    ${errMsgLine}`)

  const jsdocParams = jsdoc.split('\n').filter(line => line.startsWith(' * @param')).reduce((params, line) => {
    const [, type, name, description] = line.match(/@param\s+{(\S+)}\s+(\S+)\s+-\s+(.*)/m)
    params.push({ name, type, description })
    return params
  }, [])

  if (help) {
    const args = jsdocParams.filter(param => {
      if (param.name.startsWith('[')) return false
      if (param.name.includes('.')) return false
      return true
    })
    if (args.length !== command.main.length) {
      const s = args.length === 1 ? '' : 's'
      throw new Error(`Outdated JSDOC notation. Found ${args.length} argument${s} instead of ${command.main.length}.\n    ${errMsgLine}`)
    }
    const argsNotation = args.map(param => `<${param.name}>`).join(' ')
    const options = jsdocParams.filter(param => param.name.startsWith('[options.'))
      .map(param => {
        const [name, ...descr] = param.name.slice('[options.'.length, -1).split('=')
        const title = descr.length === 0 ? `${name} (${param.type})` : `${name} (${param.type}, default: ${descr.join('=')})`
        return `  --${title} - ${param.description}`
      })

    console.log([
      `Usage: npm -s start -- ${command.name} ${argsNotation ? `${argsNotation} ` : ''}[options]`,
      '',
      args.length === 0 ? null : 'Arguments:',
      args.length === 0 ? null : [...args.map(arg => `  ${arg.name} (${arg.type}) - ${arg.description}`)],
      args.length === 0 ? null : '',
      'Options:',
      '  --help - Show this help message.',
      ...options
    ].flat().filter(line => line !== null).join('\n'))
    process.exit(0)
  }

  if (args.positionals.length > command.main.length) {
    throw new Error([
      errMsg,
      ...jsdocParams.map(param => `* ${param.name} (${param.type}) - ${param.description}`),
      '\n' + errMsgLine
    ].join('\n  '))
  }

  const missingParams = jsdocParams.slice(args.positionals.length, command.main.length)
  if (missingParams.length === 0) throw new Error(`${errMsg}\n    ${errMsgLine}`)

  throw new Error([
    `${errMsg} The following positional argument${s ? 's are' : ' is'} missing:`,
    ...missingParams.map(param => `* ${param.name} (${param.type}) - ${param.description}`),
    '\n' + errMsgLine
  ].join('\n  '))
}

/**
 * Parses a command file.
 * @param {string} file - The file path of the command.
 * @param {acorn.Options} options - The options for the parser.
 * @returns {Promise<estraverse.AST>} The AST of the command file.
 */
export async function parseCommandFile (file, options) {
  const comments = []
  const code = await fs.promises.readFile(file, { encoding: 'utf-8' })
  const ast = acorn.parse(code, {
    ecmaVersion: 'latest',
    sourceType: 'module',
    allowReserved: true,
    locations: true,
    allowHashBang: true,
    onComment: (block, text, start, end) => {
      comments.push({ block, text, start, end })
    }
  })
  return estraverse.traverse(ast, {
    ...options,
    enter (node, ...args) {
      if (node.type === 'FunctionDeclaration') {
        node.comments = comments.filter(comment =>
          comment.start <= node.start && comment.end >= node.end
        )

        // find the jsdoc comment that precedes the node
        node.jsdoc = comments.filter(comment =>
          comment.block === true &&
          comment.start < node.start &&
          comment.end < node.start
        ).pop()
      }

      if (options.enter) options.enter(node, ...args)
    }
  })
}
