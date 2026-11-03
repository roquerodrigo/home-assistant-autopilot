import { parse as parseToml } from 'smol-toml'

import type { IntegrationManifest } from './integration-manifest.ts'

import { InvalidProjectError } from './errors.ts'

export interface VersionDeclaration {
  path: string
  version: string
}

export interface VersionSources {
  integrationManifest?: { manifest: IntegrationManifest, path: string }
  packageJson?: string
  pyproject?: string
}

interface PythonProject {
  project?: {
    dynamic?: string[]
    version?: string
  }
}

export const PACKAGE_JSON_PATH = 'package.json'
export const PYPROJECT_PATH = 'pyproject.toml'

export function versionDeclarationsOf(sources: VersionSources): VersionDeclaration[] {
  const declarations: VersionDeclaration[] = []
  const { integrationManifest, packageJson, pyproject } = sources
  if (integrationManifest?.manifest.version) {
    declarations.push({ path: integrationManifest.path, version: integrationManifest.manifest.version })
  }
  const pythonVersion = pyproject === undefined ? undefined : pythonVersionOf(pyproject)
  if (pythonVersion) {
    declarations.push({ path: PYPROJECT_PATH, version: pythonVersion })
  }
  const nodeVersion = packageJson === undefined ? undefined : nodeVersionOf(packageJson)
  if (nodeVersion) {
    declarations.push({ path: PACKAGE_JSON_PATH, version: nodeVersion })
  }
  return declarations
}

export function versionOfTag(tag: string): string {
  return tag.replace(/^v(?=\d)/, '')
}

function nodeVersionOf(text: string): string | undefined {
  try {
    const { version } = JSON.parse(text) as { version?: unknown }
    return typeof version === 'string' ? version : undefined
  } catch {
    throw new InvalidProjectError(`${PACKAGE_JSON_PATH} is not valid JSON`)
  }
}

function pythonVersionOf(text: string): string | undefined {
  let parsed: PythonProject
  try {
    parsed = parseToml(text) as PythonProject
  } catch {
    throw new InvalidProjectError(`${PYPROJECT_PATH} is not valid TOML`)
  }
  const { project } = parsed
  return project?.dynamic?.includes('version') ? undefined : project?.version
}
