/**
 * @file This file verifies that the `create_proxy_config` command works as expected.
 */

import * as cmd from 'node:child_process'

import { assert } from '../mocha.globals.mjs'

describe('create_proxy_config', async () => {
  it('--dryRun', async () => {
    assert.doesNotThrow(() => cmd.execSync('npm -s start -- create_proxy_config examples/hcloud.yml examples --dryRun'))
  })
})
