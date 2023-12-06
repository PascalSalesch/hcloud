/**
 * @file Entry point for the GitHub Actions CLI.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as url from 'node:url'
import * as cmd from 'node:child_process'

const __filename = url.fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const __root = path.resolve(__dirname, '..')

// Get all command names.
const commandNames = fs.readdirSync(path.resolve(__root, 'src', 'commands')).map(name => name.replace(/\.m?js$/, ''))

// Install dependencies if not already installed.
if (!fs.existsSync(path.resolve(__root, 'node_modules'))) {
  cmd.execSync('npm ci --omit=dev', { cwd: __root, stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production' } })
}

process.nextTick(main)

/**
 * Parses the inputs and executes the action.
 */
async function main () {
  const core = await import('@actions/core')
  const hcloudToken = core.getInput('hcloud_token') || process.env.HCLOUD_TOKEN
  const githubToken = core.getInput('github_token') || process.env.GITHUB_TOKEN
  const githubActor = core.getInput('github_actor') || process.env.GITHUB_ACTOR
  const cwd = core.getInput('github_workspace') || process.env.GITHUB_WORKSPACE || process.cwd()

  const macros = {
    'github.action_path': __root
  }

  const commands = (core.getMultilineInput('run')).map((command) => {
    if (command.startsWith('#')) return null
    if (!(command.trim())) return null
    if (command === 'destroy') return `cd ${path.resolve(cwd, 'dist')} && terraform destroy -auto-approve`
    if (!isValidCommand(command)) throw new Error(`Invalid command: ${command}`)
    for (const [key, value] of Object.entries(macros)) command = command.replaceAll(`\${${key}}`, value)
    return `node ${path.resolve(__root, 'src', 'hcloud.mjs')} ${command}`
  }).filter(Boolean)

  const env = { ...process.env }
  if (hcloudToken) env.HCLOUD_TOKEN = hcloudToken
  if (githubToken) env.GITHUB_TOKEN = githubToken
  if (githubActor) env.GITHUB_ACTOR = githubActor

  for (const command of commands) {
    cmd.execSync(command, { cwd, stdio: 'inherit', env })
  }
}

/**
 * Checks if the given command name is valid.
 * @param {string} name - The command name to check.
 * @returns {boolean} `true` if the command is valid, otherwise `false`.
 */
function isValidCommand (name) {
  return !!(commandNames.find(commandName => name.startsWith(commandName)))
}
