import { InvalidProjectError } from './errors.ts'

export interface IntegrationManifest {
  domain: string | undefined
  version: string | undefined
}

export const DOMAIN_FORMAT = /^[a-z0-9]+(?:_[a-z0-9]+)*$/

export function parseIntegrationManifest(text: string, path: string): IntegrationManifest {
  let declared: unknown
  try {
    declared = JSON.parse(text)
  } catch {
    throw new InvalidProjectError(`${path} is not valid JSON`)
  }
  const { domain, version } = (typeof declared === 'object' && declared !== null ? declared : {}) as Record<string, unknown>
  return {
    domain: typeof domain === 'string' ? domain : undefined,
    version: typeof version === 'string' ? version : undefined,
  }
}
