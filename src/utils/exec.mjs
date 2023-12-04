/**
 * @file Utility functions to execute shell commands.
 */
import * as cmd from 'child_process'
import { promisify } from 'node:util'

/**
 * Executes a shell command.
 * @param {string} command - The command to execute.
 * @param {object} [options] - The options to pass to child_process.exec.
 * @returns {Promise<{stdout:string, stderr:string, exitCode:number}>} - The stdout of the command.
 */
export default async function exec (command, options = {}) {
  try {
    const output = await promisify(cmd.exec)(command, options)
    if (!output.exitCode) output.exitCode = 0
    return output
  } catch (err) {
    return { stdout: err.stdout || err.message, stderr: err.stderr || err.message, exitCode: err.exitCode || 1 }
  }
}
