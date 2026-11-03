import type { ProjectSource } from './ports.ts'

import { InvalidProjectError } from '../domain/errors.ts'
import { detectProject, type HomeAssistantProject } from '../domain/home-assistant-project.ts'
import { type IntegrationManifest, parseIntegrationManifest } from '../domain/integration-manifest.ts'
import { MARKETPLACE_MANIFEST_PATH, parseMarketplaceManifest } from '../domain/marketplace-manifest.ts'
import {
  PACKAGE_JSON_PATH,
  PYPROJECT_PATH,
  type VersionDeclaration,
  versionDeclarationsOf,
} from '../domain/version-declarations.ts'

export interface ProjectSnapshot {
  integrationManifest: IntegrationManifest | undefined
  project: HomeAssistantProject
  versions: VersionDeclaration[]
}

const decoder = new TextDecoder()

export async function readProjectSnapshot(source: ProjectSource, repositoryName: string): Promise<ProjectSnapshot> {
  const files = await source.files()
  const manifestText = await readText(source, MARKETPLACE_MANIFEST_PATH)
  if (manifestText === undefined) {
    throw new InvalidProjectError(`there is no ${MARKETPLACE_MANIFEST_PATH} at the root, which every Home Assistant Marketplace repository needs`)
  }
  const project = detectProject(files, parseMarketplaceManifest(manifestText), repositoryName)
  const path = project.integrationManifestPath
  const integrationManifestText = path ? await readText(source, path) : undefined
  const integrationManifest = path && integrationManifestText !== undefined ?
      parseIntegrationManifest(integrationManifestText, path) :
    undefined
  const versions = versionDeclarationsOf({
    integrationManifest: path && integrationManifest ? { manifest: integrationManifest, path } : undefined,
    packageJson: await readText(source, PACKAGE_JSON_PATH),
    pyproject: await readText(source, PYPROJECT_PATH),
  })
  return { integrationManifest, project, versions }
}

async function readText(source: ProjectSource, path: string): Promise<string | undefined> {
  const content = await source.read(path)
  return content === undefined ? undefined : decoder.decode(content)
}
