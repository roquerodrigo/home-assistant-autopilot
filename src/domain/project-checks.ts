import type { HomeAssistantProject } from './home-assistant-project.ts'
import type { IntegrationManifest } from './integration-manifest.ts'
import type { VersionDeclaration } from './version-declarations.ts'

import { DOMAIN_FORMAT } from './integration-manifest.ts'
import { MARKETPLACE_MANIFEST_PATH } from './marketplace-manifest.ts'
import { DOWNLOAD_LIMIT, exceededLimit, TEMPLATE_LIMIT } from './release-asset.ts'
import { concludedCheck, type Finding, skippedCheck, type ValidationCheck } from './validation-report.ts'

export const CHECK_NAMES = {
  catalog: 'Catalog',
  downloadSize: 'Download size',
  hassfest: 'Hassfest',
  layout: 'Layout',
  marketplaceManifest: MARKETPLACE_MANIFEST_PATH,
  versions: 'Versions',
} as const

const CATEGORY_LABEL: Record<HomeAssistantProject['category'], string> = {
  dashboard: 'Dashboard module',
  integration: 'Integration',
  template: 'Template',
  theme: 'Theme',
}

export function describeProject(project: HomeAssistantProject, integrationManifest?: IntegrationManifest): string {
  const subject = integrationManifest?.domain ?? project.directoryDomain ?? project.releaseAsset?.name ?? project.installedFiles[0]?.path
  return subject ? `${CATEGORY_LABEL[project.category]} \`${subject}\`` : CATEGORY_LABEL[project.category]
}

export function downloadSizeCheck(project: HomeAssistantProject): ValidationCheck {
  const limit = project.category === 'template' ? TEMPLATE_LIMIT : DOWNLOAD_LIMIT
  const exceeded = exceededLimit(project.installedFiles, limit)
  const findings: Finding[] = exceeded ? [{ message: `What the Home Assistant Marketplace installs is ${exceeded}`, severity: 'error' }] : []
  const bytes = project.installedFiles.reduce((total, file) => total + file.size, 0)
  const files = project.installedFiles.length
  return concludedCheck(CHECK_NAMES.downloadSize, findings, `${files} file${files === 1 ? '' : 's'}, ${(bytes / 1024).toFixed(1)} KiB`)
}

export function layoutCheck(project: HomeAssistantProject, integrationManifest: IntegrationManifest | undefined): ValidationCheck {
  const findings: Finding[] = []
  const path = project.integrationManifestPath
  if (project.category === 'integration' && path) {
    const domain = integrationManifest?.domain
    if (!domain) {
      findings.push({ file: path, message: 'The manifest declares no domain', severity: 'error' })
    } else if (!DOMAIN_FORMAT.test(domain)) {
      findings.push({ file: path, message: `The domain "${domain}" must use lowercase letters, digits and single underscores`, severity: 'error' })
    } else if (project.directoryDomain && domain !== project.directoryDomain) {
      findings.push({ file: path, message: `The domain "${domain}" differs from its directory, custom_components/${project.directoryDomain}`, severity: 'error' })
    }
    if (!integrationManifest?.version) {
      findings.push({ file: path, message: 'The manifest declares no version, and the Home Assistant Marketplace refuses to install it', severity: 'error' })
    }
  }
  return concludedCheck(CHECK_NAMES.layout, findings, describeProject(project, integrationManifest))
}

export function marketplaceManifestCheck(project: HomeAssistantProject): ValidationCheck {
  const { category, manifest } = project
  const findings: Finding[] = []
  const error = (message: string) => findings.push({ file: MARKETPLACE_MANIFEST_PATH, message, severity: 'error' })
  const warning = (message: string) => findings.push({ file: MARKETPLACE_MANIFEST_PATH, message, severity: 'warning' })
  if (!manifest.name) {
    error('`name` is required to enter the catalog')
  }
  if (manifest.zipRelease && category !== 'integration') {
    error('`zip_release` only applies to integrations')
  } else if (manifest.zipRelease && !manifest.filename?.endsWith('.zip')) {
    error('`zip_release` needs `filename` to name the zip attached to each release, ending in .zip')
  } else if (category === 'integration' && manifest.filename && !manifest.zipRelease) {
    warning('`filename` names the release zip of an integration, so without `zip_release` nothing reads it')
  }
  for (const { key, reason } of manifest.obsoleteKeys) {
    warning(`\`${key}\` can be removed: ${reason}`)
  }
  const summary = project.releaseAsset ? `Each release ships \`${project.releaseAsset.name}\`` : 'Consistent'
  return concludedCheck(CHECK_NAMES.marketplaceManifest, findings, summary)
}

export function releaseVersionConflicts(declarations: readonly VersionDeclaration[], version: string): VersionDeclaration[] {
  return declarations.filter((declaration) => declaration.version !== version)
}

export function versionsCheck(declarations: readonly VersionDeclaration[]): ValidationCheck {
  const [first] = declarations
  if (!first) {
    return skippedCheck(CHECK_NAMES.versions, 'Nothing declares a version')
  }
  const disagreeing = declarations.filter((declaration) => declaration.version !== first.version)
  const findings: Finding[] = disagreeing.map((declaration) => ({
    file: declaration.path,
    message: `Declares ${declaration.version}, while ${first.path} declares ${first.version}`,
    severity: 'error',
  }))
  const where = declarations.map((declaration) => declaration.path).join(', ')
  return concludedCheck(CHECK_NAMES.versions, findings, `${first.version} in ${where}`)
}
