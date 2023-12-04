/**
 * @file Interprets template literals.
 */

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

/**
 * Evaluates template literals.
 * @param {object} ctx - Variables that are available in the template.
 * @param {string} content - The content string whose template literals should be evaluated.
 * @param {object} [options] - The options.
 * @param {boolean} [options.throwOnUndefined=true] - If true, an error is thrown if a variable is undefined.
 * @returns {Promise<string>} The evaluated string.
 */
export default async function parse (ctx, content, options = {}) {
  if (ctx.ctx) throw new Error('ctx.ctx is a reserved variable name')
  const context = this
  const parts = await Promise.all(splitByTemplateLiterals(content).map(part => {
    if (part.type === 'static') return part.value.replace(/`/g, '\\`')
    else if (part.type === 'dynamic') return evaluate(context, { ...ctx, ctx }, part.value, options)
    else throw new Error(`Unknown part type: ${part.type}`)
  }))
  return parts.join('')
}

/**
 * Evaluates a dynamic template literal.
 * @param {object} context - The context in which the template literal is evaluated.
 * @param {object} ctx - Variables that are available in the template.
 * @param {string} str - The dynamic template literal.
 * @param {object} [options] - The options.
 * @param {boolean} [options.throwOnUndefined=true] - If true, an error is thrown if a variable is undefined.
 * @returns {Promise<string>} The evaluated string.
 */
async function evaluate (context, ctx, str, options = {}) {
  options.throwOnUndefined = !!(options.throwOnUndefined ?? true)

  const renderFunction = new AsyncFunction(...Object.keys(ctx), 'return `${' + str + '}`')
  const renderedContent = await (renderFunction.call(context, ...Object.values(ctx)))
  if (options.throwOnUndefined && renderedContent === 'undefined') throw new Error(`Variable is undefined: ${str}`)
  return renderedContent
}

/**
 * Seperate a string into parts of static and dynamic parts.
 * @todo Support comments that contain template literals.
 * @param {string} str - The string to split.
 * @returns {Array<{type: 'static'|'dynamic', value: string}>} The parts of the string.
 * @throws {Error} - If the template literal is invalid.
 */
function splitByTemplateLiterals (str) {
  const parts = []

  let currentPart = ''
  let isDynamic = false
  let depth = 0
  for (let i = 0; i < str.length; i++) {
    const previous = i === 0 ? null : str.charAt(i - 1)
    const current = str.charAt(i)

    if (isDynamic) {
      if (current === '{') {
        depth = depth + 1
        if (depth > 1) currentPart = currentPart + current
      } else if (current === '}') {
        depth = depth - 1
        if (depth === 0) {
          isDynamic = false
          parts.push({ type: 'dynamic', value: currentPart })
          currentPart = ''
        } else {
          currentPart = currentPart + current
        }
      } else {
        currentPart = currentPart + current
      }
    } else {
      const next = str.charAt(i + 1)
      if (current === '$' && next === '{') {
        if (previous !== '\\') {
          isDynamic = true
          if (currentPart) {
            parts.push({ type: 'static', value: currentPart })
            currentPart = ''
          }
        } else {
          currentPart = currentPart.slice(0, -1) + current
          if (i === str.length - 1) {
            parts.push({ type: 'static', value: currentPart })
            currentPart = ''
          }
        }
      } else {
        currentPart = currentPart + current
        if (i === str.length - 1) {
          parts.push({ type: 'static', value: currentPart })
          currentPart = ''
        }
      }
    }
  }

  if (currentPart) {
    if (depth > 0) throw new Error(`Invalid template literal. Missing ${depth} '}'`)
    else throw new Error(`Invalid template literal. Unknown: ${currentPart}`)
  }

  return parts
}
