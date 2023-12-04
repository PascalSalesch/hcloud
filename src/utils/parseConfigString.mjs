/**
 * @file Utility function to parse the configuration string.
 */

import * as yaml from 'yaml'

import Server from '../classes/Server.mjs'
import Service from '../classes/Service.mjs'
import SSHKey from '../classes/SSHKey.mjs'
import Volume from '../classes/Volume.mjs'

/**
 * @typedef {object} Config
 * @property {Array<Server>} servers - The servers.
 * @property {Array<SSHKey>} sshKeys - The SSH keys.
 * @property {Array<Service>} services - The services.
 * @property {Array<Volume>} volumes - The volumes.
 */

/**
 * Parses the configuration and creates the resources.
 * @param {string} configString - The configuration in YAML format.
 * @returns {Config} The parsed configuration.
 * @throws {Error} If no servers are defined.
 * @throws {Error} If no SSH keys are defined.
 * @throws {Error} If no services are defined.
 */
export default function hcloud (configString) {
  const config = yaml.parse(configString)
  const servers = Object.entries(config.servers || {}).map(([name, options]) => new Server(name, options))
  const sshKeys = Object.entries(config.ssh_keys || {}).map(([name, options]) => new SSHKey(name, options))
  const volumes = Object.entries(config.volumes || {}).map(([name, options]) => new Volume(name, options))
  const services = Object.entries(config.services || {}).map(([name, options]) => new Service(name, options))

  if (servers.length === 0) throw new Error('No servers defined.')
  if (sshKeys.length === 0) throw new Error('No SSH keys defined.')
  if (services.length === 0) throw new Error('No services defined.')
  return {
    servers,
    sshKeys,
    volumes,
    services
  }
}
