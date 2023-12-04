/**
 * @file This file verifies that the `create_service_config` command works as expected.
 */

import * as cmd from 'node:child_process'

import { assert } from '../mocha.globals.mjs'

describe('create_service_config', async () => {
  it('--dryRun', async () => {
    assert.doesNotThrow(() => cmd.execSync('npm -s start -- create_service_config examples/hcloud.yml examples --dryRun'))
  })
})
