import { InvalidProjectError } from './errors.ts'

export const MARKETPLACE_MANIFEST_PATH = 'hacs.json'

export interface MarketplaceManifest {
  contentInRoot: boolean
  filename: string | undefined
  name: string | undefined
  obsoleteKeys: readonly ObsoleteKey[]
  zipRelease: boolean
}

export interface ObsoleteKey {
  key: string
  reason: string
}

const OBSOLETE_KEYS: Record<string, string> = {
  hacs: 'the Home Assistant Marketplace reads the minimum HACS version but never compares it',
  render_readme: 'the Home Assistant Marketplace no longer reads it',
}

export function parseMarketplaceManifest(text: string): MarketplaceManifest {
  let declared: unknown
  try {
    declared = JSON.parse(text)
  } catch {
    throw new InvalidProjectError(`${MARKETPLACE_MANIFEST_PATH} is not valid JSON`)
  }
  if (typeof declared !== 'object' || declared === null || Array.isArray(declared)) {
    throw new InvalidProjectError(`${MARKETPLACE_MANIFEST_PATH} must hold a JSON object`)
  }
  const keys = declared as Record<string, unknown>
  return {
    contentInRoot: optionalBoolean(keys, 'content_in_root'),
    filename: optionalText(keys, 'filename'),
    name: optionalText(keys, 'name'),
    obsoleteKeys: Object.keys(OBSOLETE_KEYS)
      .filter((key) => key in keys)
      .map((key) => ({ key, reason: OBSOLETE_KEYS[key] })),
    zipRelease: optionalBoolean(keys, 'zip_release'),
  }
}

function optionalBoolean(keys: Record<string, unknown>, key: string): boolean {
  const value = keys[key]
  if (value !== undefined && typeof value !== 'boolean') {
    throw new InvalidProjectError(`${key} in ${MARKETPLACE_MANIFEST_PATH} must be true or false`)
  }
  return value ?? false
}

function optionalText(keys: Record<string, unknown>, key: string): string | undefined {
  const value = keys[key]
  if (value !== undefined && (typeof value !== 'string' || value.trim() === '')) {
    throw new InvalidProjectError(`${key} in ${MARKETPLACE_MANIFEST_PATH} must be a non-empty string`)
  }
  return value
}
