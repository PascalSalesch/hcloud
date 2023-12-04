/**
 * @file Service class.
 * This class is used to validate the configuration. It is not used to form any relationships between resources.
 */

import * as cmd from 'node:child_process'

import * as stringUtils from '../utils/stringUtils.mjs'
import parser from '../utils/parse.mjs'
import exec from '../utils/exec.mjs'

// Define contents
const content = `
\${image.name}:
  image: \${image.image}
  \${image.portsString.trim() ? 'ports:' : ''}
    \${image.portsString}
  \${image.volumes.trim() ? 'volumes:' : ''}
    \${image.volumes}
  \${image.environment.trim() ? 'environment:' : ''}
    \${image.environment}
`

/**
 * @typedef {object} Image
 * @property {string} name - The name of the image.
 * @property {string} version - The version of the image.
 * @property {string} image - The full image string.
 * @property {string} url - The url of the image.
 * @property {string} org - The organization of the image.
 * @property {string} repo - The repository of the image.
 * @property {string} tag - The tag of the image.
 * @property {string} content - The content of the image.
 * @property {string} ports - The ports of the image.
 * @property {string} portsString - The ports of the image as a string.
 * @property {string} volumes - The volumes of the image.
 * @property {string} environment - The environment of the image.
 */

/**
 * Represents a swarm of images running on a server.
 */
export default class Service {
  /**
   * The list of SSH keys.
   * @type {Service[]}
   */
  static #instances = []

  /**
   * Implements the iterator protocol.
   * @returns {Array<Service>} The iterator.
   */
  static [Symbol.iterator] () {
    return this.#instances[Symbol.iterator]()
  }

  /**
   * Filters the services.
   * @param {...any} args - Arguments to pass on.
   * @returns {Service[]} The filtered services.
   */
  static filter (...args) {
    return [...this.#instances].filter(...args)
  }

  /**
   * The name of the service.
   * @type {string}
   */
  #name = null

  set name (value) {
    if (typeof value !== 'string') throw new TypeError(`Expected string, got ${typeof value} in Service name "${value}"`)
    this.#name = value
  }

  get name () {
    return this.#name
  }

  /**
   * The images associated with the service.
   * @type {string[]}
   */
  #images = null

  set images (value) {
    if (this.#images !== null) throw new Error('Images already set')
    if (!Array.isArray(value)) throw new TypeError(`Expected array, got ${typeof value} in "${this.name}" Service images "${value}"`)
    if (value.length === 0) throw new Error('Images must not be empty')
    this.#images = value
  }

  get images () {
    return [...this.#images]
  }

  /**
   * The ports to expose for the service.
   * @type {string[]}
   */
  #ports = null

  set ports (value) {
    if (this.#ports !== null) throw new Error('Ports already set')
    if (!Array.isArray(value)) throw new TypeError(`Expected array, got ${typeof value} in "${this.name}" Service ports "${value}"`)
    this.#ports = value
  }

  get ports () {
    return [...this.#ports]
  }

  /**
   * The reverse proxy configurations for the service.
   * @type {string[]}
   */
  #proxies = null

  set proxies (value) {
    if (this.#proxies !== null) throw new Error('Proxies already set')
    if (!Array.isArray(value)) throw new TypeError(`Expected array, got ${typeof value} in "${this.name}" Service proxies "${value}"`)
    this.#proxies = value
  }

  get proxies () {
    return [...this.#proxies]
  }

  /**
   * The environment variables for the service.
   * @type {{[key: string]: string}}
   */
  #environment = null

  set environment (value) {
    if (this.#environment !== null) throw new Error('Environment already set')
    if (typeof value !== 'object') throw new TypeError(`Expected object, got ${typeof value} in "${this.name}" Service environment "${value}"`)
    if (value === null) throw new TypeError(`Expected object, got null in Service environment "${value}"`)
    this.#environment = value
  }

  get environment () {
    return this.#environment
  }

  /**
   * The volumes to expose for the service.
   * @type {string[]}
   */
  #volumes = null

  set volumes (value) {
    if (this.#volumes !== null) throw new Error('Volumes already set')
    if (!Array.isArray(value)) throw new TypeError(`Expected array, got ${typeof value} in "${this.name}" Service volumes "${value}"`)
    this.#volumes = value
  }

  get volumes () {
    return [...this.#volumes]
  }

  /**
   * Creates a new service.
   * @param {string} name - The name of the service.
   * @param {object} options - The service options.
   * @param {string[]} options.images - The images associated with the service.
   * @param {string[]} [options.ports] - The ports to expose for the service.
   * @param {string[]} [options.proxies] - The reverse proxy configurations for the service.
   * @param {{[key: string]: string}} [options.environment={}] - The environment variables for the service.
   * @param {string[]} [options.volumes] - The volumes to expose for the service.
   */
  constructor (name, options) {
    this.name = name
    this.images = options.images
    this.ports = options.ports || []
    this.proxies = options.proxies || []
    this.environment = options.environment || {}
    this.volumes = options.volumes || []

    Service.#instances.push(this)
  }

  /**
   * Resolves the images for the service.
   * @param {import('../utils/globalContext.mjs').GlobalContextParams} ctx - The global context.
   * @param {import('../classes/Server.mjs').default} server - The server to resolve the images for.
   * @returns {Image[]} The images for the service.
   * @throws {Error} If the image string is not valid.
   */
  async getImages (ctx, server) {
    const images = []
    const parse = parser.bind(this)
    const environment = { ...server.environment, ...this.environment }
    const environmentString = Object.entries(environment).map(([key, value]) => `${key}: "${value}"`).join('\n    ')
    const serverDetails = ctx.serverDetailsMapping[server.name] || server.toObject()

    for (const imageString of this.images) {
      const imagesFromString = await getImageFlatMap(parseImageString(imageString), { ...environment, ...ctx.env })

      for (const image of imagesFromString) {
        if (image.org === undefined) throw new Error(`Missing organization in image string "${imageString}"`)
        if (image.repo === undefined) throw new Error(`Missing repository in image string "${imageString}"`)
        if (image.tag === undefined) throw new Error(`Missing tag in image string "${imageString}"`)

        image.name = `${this.name}-${image.url}-${image.org}-${image.repo}-${image.tag}`.replace(/[^a-z0-9-]/g, '-').replace(/--+/g, '-')
        image.version = image.tag
        image.image = `${image.url}/${image.org}/${image.repo}:${image.tag}`
        image.volumes = this.volumes?.map(volume => `- "${volume}"`).join('\n    ') || ''
        image.environment = environmentString
        image.ports = await getImagePorts(ctx, this, image, serverDetails)
        if (!(image.ports) || image.ports?.length === 0) throw new Error(`Missing ports in image "${imageString}"`)
        image.portsString = image.ports?.map(({ host, container }) => host ? `- "${host}:${container}"` : `- "${container}"`).join('\n    ') || ''

        const context = { ...ctx, image, server: serverDetails, service: this }
        // parse twice, once to fill in the variables and once to replace macros
        image.content = stringUtils.trimLine(ctx, await parse(context, await parse(context, content)))

        images.push(image)
      }
    }

    return images
  }
}

/**
 * @typedef {object} ImageFromString
 * @property {string} url - The url of the image.
 * @property {string} org - The organization of the image.
 * @property {string} repo - The repository of the image.
 * @property {string} tag - The tag of the image.
 */

/**
 * Returns the images from an image object.
 * @param {ImageFromString} image - The image object.
 * @param {object} env - The environment variables.
 * @returns {Promise<ImageFromString[]>} An array of images.
 */
async function getImageFlatMap (image, env) {
  const images = []

  /**
   * Fetches a path from the GitHub API.
   * @param {string} method - The method to use.
   * @param {string} path - The path to fetch.
   * @param {object} [query={}] - The query parameters.
   * @returns {Promise<Response>} The response.
   */
  async function api (method, path, query = null) {
    const url = new URL(path, 'https://api.github.com')
    if (query) for (const [key, value] of Object.entries(query)) url.searchParams.append(key, value)
    const headers = {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }
    const headersString = `${Object.entries(headers).map(([key, value]) => `-H "${key}: ${key === 'Authorization' ? '***' : value}"`).join(' ')}`

    let result = null
    while (true) {
      console.log(`$ curl -X ${method} ${url} ${headersString}`)
      const response = await fetch(url, { method, headers })
      if (!response.ok) throw new Error(`Failed to fetch "${url}". ${response.status} ${response.statusText}:\n  ${await response.text()}`)
      const pageResult = response.json()
      if (Array.isArray(pageResult)) {
        if (result === null) {
          url.searchParams.set('page', '1')
          url.searchParams.set('per_page', '30')
          result = []
        }
        result.push(...pageResult)
        if (pageResult.length < 30) break
        url.searchParams.set('page', (parseInt(url.searchParams.get('page')) + 1).toString())
      } else {
        result = pageResult
        break
      }
    }

    return result
  }

  /**
   * Returns all packages for an organization.
   * @returns {Promise<string[]>} An array of packages.
   */
  async function getAllPackages () {
    if (!image.url.endsWith('ghcr.io')) throw new Error(`Cannot get all packages for "${image.url}/${image.org}"`)
    if (!env.GITHUB_TOKEN) throw new Error('Missing GITHUB_TOKEN environment variable.')
    const userOrOrg = await api('GET', `/users/${image.org}`)
    const type = userOrOrg.type === 'Organization' ? 'orgs' : 'users'

    const packageNames = []
    const packages = await api('GET', `/${type}/${image.org}/packages`, { package_type: 'container' })
    for (const pkg of packages) if (!packageNames.includes(pkg.name)) packageNames.push(pkg.name)

    return packageNames
  }

  /**
   * Returns all tags for a repository.
   * @param {string} packageName - The repository.
   * @returns {Promise<string[]>} An array of tags.
   */
  async function getAllTags (packageName) {
    if (!image.url.endsWith('ghcr.io')) throw new Error(`Cannot get all tags for "${image.url}/${image.org}/${packageName}"`)
    if (!env.GITHUB_TOKEN) throw new Error('Missing GITHUB_TOKEN environment variable.')
    const userOrOrg = await api('GET', `/users/${image.org}`)
    const type = userOrOrg.type === 'Organization' ? 'orgs' : 'users'

    const tags = await api('GET', `/${type}/${image.org}/packages/container/${packageName}/versions`)
    const tagNames = tags.map(tag => tag.metadata.container.tags.flat()).flat()
    return tagNames
  }

  /**
   * Pushes all matching images to the images array.
   * @param {string} repo - The repository.
   * @param {string} tag - The tag.
   */
  async function pushMatchingImages (repo, tag) {
    if (!(tag.includes('*'))) {
      images.push({ ...image, repo, tag })
      return
    }

    const tags = await getAllTags(repo)
    for (const tag of tags) {
      if (tag.match(new RegExp(`^${image.tag.replace(/\*/g, '.*')}$`))) {
        images.push({ ...image, repo, tag })
      }
    }
  }

  if (image.repo.includes('*')) {
    if (!image.url.endsWith('ghcr.io')) throw new Error(`Cannot get all repositories for "${image.url}"`)
    const repos = (await getAllPackages()).filter(repo => repo.match(new RegExp(`^${image.repo.replace(/\*/g, '.*')}$`)))
    for (const repo of repos) await pushMatchingImages(repo, image.tag)
  } else {
    await pushMatchingImages(image.repo, image.tag)
  }

  return images
}

/**
 * Parses an image string.
 * @param {string} imageString - The image string to parse.
 * @returns {ImageFromString} The parsed image string.
 * @throws {TypeError} If the image string is not a string.
 */
function parseImageString (imageString) {
  if (typeof imageString !== 'string') throw new TypeError(`Expected string, got ${typeof imageString} in image string "${imageString}"`)
  if (imageString.replace(/[*:]/g, '') === '') throw new Error('Image string must not be empty')

  let org = '*'
  let repo = '*'
  let tag = '*'
  if (imageString.includes(':')) {
    imageString = imageString.split(':')
    tag = imageString.pop()
    imageString = imageString.join(':')
  }
  if (imageString.includes('/')) {
    imageString = imageString.split('/')
    repo = imageString.pop()
    imageString = imageString.join('/')
  }
  if (imageString.includes('/')) {
    imageString = imageString.split('/')
    org = imageString.pop()
    imageString = imageString.join('/')
  }
  const url = imageString || 'ghcr.io'

  return { url, org, repo, tag }
}

/**
 * Returns the ports of an image.
 * @param {import('../utils/globalContext.mjs').GlobalContextParams} ctx - The global context.
 * @param {Service} service - The service.
 * @param {Image} image - The image.
 * @param {import('../classes/Server.mjs').default} server - The server.
 * @returns {Promise<{ host: string, container: string, details: object }[]>} The ports of the image.
 */
async function getImagePorts (ctx, service, image, server) {
  const ports = []
  if (service.ports.length) {
    const staticPorts = (() => {
      const staticPorts = []
      for (const portConfig of service.ports) {
        if (portConfig.split(':').length > 3) throw new Error(`Invalid port configuration "${portConfig}"`)
        else if (portConfig.split(':').length === 3) {
          const [proxyPort, host, container] = portConfig.split(':')
          if (proxyPort === host) {
            staticPorts.push({ proxyPort: null, host, container })
          } else {
            staticPorts.push({ proxyPort, host, container })
          }
        } else if (portConfig.split(':').length === 2) {
          const [proxyPort, container] = portConfig.split(':')
          staticPorts.push({ proxyPort, host: null, container })
        } else {
          const [container] = portConfig.split(':')
          staticPorts.push({ proxyPort: container, host: null, container })
        }
      }
      return staticPorts
    })()
    ports.push(...staticPorts)
  }
  if (service.proxies.length) {
    const parse = parser.bind(service)
    for (const proxyString of service.proxies) {
      const context = { ...ctx, image, server, service }
      const details = parseProxyString(await parse(context, proxyString))
      const port = ports.find(port => port.container === details.containerPort)
      if (port) {
        if (details.hostPort) port.host = details.hostPort
        if (details.proxyPort) port.proxyPort = details.proxyPort
        port.details = details
      } else {
        ports.push({ proxyPort: details.proxyPort, host: details.hostPort, container: details.containerPort, details })
      }
    }
  }
  if (ports.length !== 0) return ports

  const containerPorts = await getImagePortsFromContainer(ctx, image)
  return containerPorts
}

/**
 * Parses a proxy string.
 * @param {string} proxyString - The proxy string to parse.
 * @returns {{schema: string, host: string, hostPort: string, proxyPort: string, containerPort: string, path: string}} The parsed proxy string.
 */
function parseProxyString (proxyString) {
  let schema, host, proxyPort, hostPort, containerPort, path

  if (proxyString.includes('://')) {
    const schemaArr = proxyString.split('://')
    schema = schemaArr.shift()
    proxyString = schemaArr.join('://')
  } else {
    schema = null
  }

  if (proxyString.includes('/')) {
    const pathArr = proxyString.split('/')
    proxyString = pathArr.shift()
    path = '/' + pathArr.join('/')
  } else {
    path = '/'
  }

  if (proxyString.includes(':')) {
    const hostArr = proxyString.split(':')
    host = hostArr.shift()
    if (hostArr.length > 2) {
      proxyPort = hostArr[0]
      hostPort = hostArr[1]
      containerPort = hostArr[2]
    } else if (hostArr.length === 2) {
      proxyPort = hostArr[0]
      hostPort = null
      containerPort = hostArr[1]
    } else {
      containerPort = hostArr[0]
      proxyPort = hostArr[0]
    }
  } else {
    host = proxyString
    proxyPort = '80'
    containerPort = null
    hostPort = null
  }

  return { schema, host, hostPort, proxyPort, containerPort, path }
}

/**
 * Pulls an image and returns the ports.
 * @param {import('../utils/globalContext.mjs').GlobalContextParams} ctx - The global context.
 * @param {Image} image - The image.
 * @returns {Promise<{ host: null, container: string, proxyPort }[]>} The ports of the image.
 */
async function getImagePortsFromContainer (ctx, image) {
  if (image.image.startsWith('ghcr.io')) {
    const username = ctx.env.GITHUB_ACTOR
    const password = ctx.env.GITHUB_TOKEN
    const registry = 'ghcr.io'
    console.log(`$ docker login -u ${username} -p ${password.replace(/.*/, '*')} ${registry}`)
    cmd.execSync(`docker login -u ${username} -p ${password} ${registry}`, { stdio: 'inherit' })
  }

  console.log(`$ docker pull ${image.image}`)
  cmd.execSync(`docker pull ${image.image}`, { stdio: 'inherit' })

  console.log(`$ docker inspect ${image.image}`)
  const outputInspect = await exec(`docker inspect ${image.image}`)
  const inspect = JSON.parse(outputInspect.stdout)
  const ports = Object.entries(inspect[0].Config.ExposedPorts).map(([container, _]) => {
    const port = container.split('/')[0]
    return {
      host: null,
      container: port,
      proxyPort: port
    }
  })
  return ports
}
