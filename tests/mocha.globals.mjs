/**
 * @file This file is run before all tests. It sets up the environment for the tests.
 * It is configured in the mocha.json in the "file" property.
 */

import { strict as assert } from 'node:assert'
import * as path from 'node:path'
import * as url from 'node:url'
import { Console } from 'node:console'
import { Writable } from 'node:stream'

class InMemoryWritableStream extends Writable {
  constructor () {
    super()
    this.data = []
  }

  _write (chunk, encoding, callback) {
    this.data.push(chunk)
    callback()
  }

  getData () {
    return Buffer.concat(this.data).toString()
  }
}

const memory = new InMemoryWritableStream()
const memoryConsole = new Console(memory, memory)
const console = global.console

// file paths
const __filename = url.fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const __root = path.resolve(__dirname, '..')

// silence tests unless they fail
before(() => { global.console = memoryConsole })
after(() => { global.console = console })
afterEach(function () {
  if (this.currentTest.state === 'failed') process.stdout.write(memory.getData())
  memoryConsole.clear()
  memory.data = []
})

// set globals
global.assert = assert
global.__root = __root

// export globals
export {
  assert,
  __root
}
