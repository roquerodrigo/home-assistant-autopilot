import type { MarketplaceManifest } from './marketplace-manifest.ts'
import type { ProjectCategory } from './project-category.ts'
import type { ReleaseAsset } from './release-asset.ts'

import { InvalidProjectError } from './errors.ts'
import { MARKETPLACE_MANIFEST_PATH } from './marketplace-manifest.ts'
import { directoryOf, filesUnder, nameOf, type ProjectFile } from './project-file.ts'

export interface HomeAssistantProject {
  category: ProjectCategory
  directoryDomain: string | undefined
  installedFiles: readonly ProjectFile[]
  integrationManifestPath: string | undefined
  manifest: MarketplaceManifest
  releaseAsset: ReleaseAsset | undefined
}

const INTEGRATION_MANIFEST = /^custom_components\/([^/]+)\/manifest\.json$/
const THEME_FILE = /\.ya?ml$/

export function detectProject(
  files: readonly ProjectFile[],
  manifest: MarketplaceManifest,
  repositoryName: string,
): HomeAssistantProject {
  if (manifest.filename?.endsWith('.jinja')) {
    return templateProject(files, manifest, manifest.filename)
  }
  const integrationDomains = files.flatMap((file) => INTEGRATION_MANIFEST.exec(file.path)?.[1] ?? []).sort()
  if (integrationDomains.length > 1) {
    throw new InvalidProjectError(`more than one integration under custom_components: ${integrationDomains.join(', ')}`)
  }
  if (integrationDomains.length === 1) {
    return integrationProject(files, manifest, integrationDomains[0])
  }
  if (manifest.contentInRoot && files.some((file) => file.path === 'manifest.json')) {
    return rootIntegrationProject(files, manifest)
  }
  const themes = files.filter((file) => THEME_FILE.test(file.path) && directoryOf(file.path) === (manifest.contentInRoot ? '' : 'themes'))
  if (themes.length > 1) {
    throw new InvalidProjectError(`a repository holds one theme, but there are ${themes.length}: ${themes.map((file) => file.path).join(', ')}`)
  }
  if (themes.length === 1) {
    return project('theme', manifest, themes)
  }
  const bundle = dashboardBundleOf(files, manifest, repositoryName)
  if (bundle) {
    return dashboardProject(files, manifest, bundle)
  }
  throw new InvalidProjectError(
    'cannot tell what this repository installs: there is no integration under custom_components, no theme under themes, ' +
    `and ${MARKETPLACE_MANIFEST_PATH} names no template or dashboard module`,
  )
}

function archiveOf(manifest: MarketplaceManifest, root: string, files: readonly ProjectFile[]): ReleaseAsset | undefined {
  const name = manifest.filename
  return manifest.zipRelease && name?.endsWith('.zip') ? { files, kind: 'archive', name, root } : undefined
}

function dashboardBundleOf(files: readonly ProjectFile[], manifest: MarketplaceManifest, repositoryName: string): ProjectFile | undefined {
  const declared = manifest.filename
  const candidates = declared ? [declared] : defaultBundleNames(repositoryName)
  const located = ['', 'dist/']
    .flatMap((directory) => candidates.map((candidate) => `${directory}${candidate}`))
    .map((path) => files.find((file) => file.path === path))
    .find((file) => file !== undefined)
  if (declared?.endsWith('.js') && !located) {
    throw new InvalidProjectError(`${declared}, named in ${MARKETPLACE_MANIFEST_PATH}, is neither at the root nor in dist`)
  }
  return located
}

function dashboardProject(files: readonly ProjectFile[], manifest: MarketplaceManifest, bundle: ProjectFile): HomeAssistantProject {
  const directory = directoryOf(bundle.path)
  return project('dashboard', manifest, directory === '' ? [bundle] : filesUnder(files, directory), {
    releaseAsset: { kind: 'file', name: nameOf(bundle.path), path: bundle.path },
  })
}

function defaultBundleNames(repositoryName: string): string[] {
  const names = [`${repositoryName}.js`, `${repositoryName}.umd.js`, `${repositoryName}-bundle.js`]
  if (repositoryName.startsWith('lovelace-')) {
    names.push(`${repositoryName.slice('lovelace-'.length)}.js`)
  }
  return names
}

function integrationProject(files: readonly ProjectFile[], manifest: MarketplaceManifest, domain: string): HomeAssistantProject {
  const root = `custom_components/${domain}`
  const installedFiles = filesUnder(files, root)
  return project('integration', manifest, installedFiles, {
    directoryDomain: domain,
    integrationManifestPath: `${root}/manifest.json`,
    releaseAsset: archiveOf(manifest, root, installedFiles),
  })
}

function project(
  category: ProjectCategory,
  manifest: MarketplaceManifest,
  installedFiles: readonly ProjectFile[],
  details: Partial<Pick<HomeAssistantProject, 'directoryDomain' | 'integrationManifestPath' | 'releaseAsset'>> = {},
): HomeAssistantProject {
  return {
    category,
    directoryDomain: details.directoryDomain,
    installedFiles,
    integrationManifestPath: details.integrationManifestPath,
    manifest,
    releaseAsset: details.releaseAsset,
  }
}

function rootIntegrationProject(files: readonly ProjectFile[], manifest: MarketplaceManifest): HomeAssistantProject {
  const installedFiles = files.filter((file) => file.path !== MARKETPLACE_MANIFEST_PATH && !file.path.startsWith('.'))
  return project('integration', manifest, installedFiles, {
    integrationManifestPath: 'manifest.json',
    releaseAsset: archiveOf(manifest, '', installedFiles),
  })
}

function templateProject(files: readonly ProjectFile[], manifest: MarketplaceManifest, filename: string): HomeAssistantProject {
  const template = files.find((file) => file.path === filename)
  if (!template) {
    throw new InvalidProjectError(`${filename}, named in ${MARKETPLACE_MANIFEST_PATH}, is not at the root`)
  }
  return project('template', manifest, [template])
}
