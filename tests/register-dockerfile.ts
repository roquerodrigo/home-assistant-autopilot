import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'

registerHooks({
  load(url, context, nextLoad) {
    if (!url.endsWith('.Dockerfile')) {
      return nextLoad(url, context)
    }
    const text = readFileSync(new URL(url), 'utf8')
    return { format: 'module', shortCircuit: true, source: `export default ${JSON.stringify(text)}` }
  },
})
