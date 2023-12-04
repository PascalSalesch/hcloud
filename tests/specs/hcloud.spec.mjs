/**
 * @file This file verifies that the main file works as expected.
 */

import * as path from 'node:path'
import * as fs from 'node:fs'
import * as url from 'node:url'

import { assert } from '../mocha.globals.mjs'

const __filename = url.fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const __root = path.resolve(__dirname, '..', '..')

const packageJson = JSON.parse(fs.readFileSync(path.resolve(__root, 'package.json'), 'utf-8'))
const main = path.resolve(__root, ...packageJson.main.split('/'))

describe(packageJson.main, async () => {
  it('import', async () => {
    let hcloud
    try {
      hcloud = await import(main)
      assert.strictEqual(typeof hcloud.default, 'function')
    } catch (err) {
      assert.doesNotThrow(() => { throw err })
    }
  })
})
