import type { HomeAssistantProject } from '../domain/home-assistant-project.ts'
import type { ExternalValidator, ProjectSource, RepositoryDirectory } from './ports.ts'

import { InvalidProjectError } from '../domain/errors.ts'
import {
  CHECK_NAMES,
  downloadSizeCheck,
  layoutCheck,
  marketplaceManifestCheck,
  versionsCheck,
} from '../domain/project-checks.ts'
import { concludedCheck, skippedCheck, ValidationReport } from '../domain/validation-report.ts'
import { readProjectSnapshot } from './project-snapshot.ts'

export interface ValidateProjectDependencies {
  catalog: ExternalValidator
  directory: RepositoryDirectory
  hassfest: ExternalValidator
  source: ProjectSource
}

export interface ValidationOutcome {
  domain: string | undefined
  project: HomeAssistantProject | undefined
  report: ValidationReport
}

const UNREADABLE_LAYOUT = 'Needs a layout it can read'

export class ValidateProject {
  private readonly dependencies: ValidateProjectDependencies

  constructor(dependencies: ValidateProjectDependencies) {
    this.dependencies = dependencies
  }

  async run(): Promise<ValidationOutcome> {
    const { catalog, directory, hassfest, source } = this.dependencies
    const repository = await directory.describe()
    let snapshot
    try {
      snapshot = await readProjectSnapshot(source, repository.name)
    } catch (error) {
      if (!(error instanceof InvalidProjectError)) {
        throw error
      }
      return { domain: undefined, project: undefined, report: unreadableProjectReport(error) }
    }
    const { integrationManifest, project, versions } = snapshot
    const checks = [
      layoutCheck(project, integrationManifest),
      marketplaceManifestCheck(project),
      versionsCheck(versions),
      downloadSizeCheck(project),
      project.category === 'integration' ?
          await hassfest.validate(project) :
          skippedCheck(CHECK_NAMES.hassfest, 'Only an integration has a manifest to validate'),
      repository.private ?
          skippedCheck(CHECK_NAMES.catalog, 'A private repository cannot enter the Home Assistant Marketplace') :
          await catalog.validate(project),
    ]
    return { domain: integrationManifest?.domain ?? project.directoryDomain, project, report: new ValidationReport(checks) }
  }
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function unreadableProjectReport(error: InvalidProjectError): ValidationReport {
  return new ValidationReport([
    concludedCheck(CHECK_NAMES.layout, [{ message: capitalized(error.message), severity: 'error' }], ''),
    ...[CHECK_NAMES.marketplaceManifest, CHECK_NAMES.versions, CHECK_NAMES.downloadSize, CHECK_NAMES.hassfest, CHECK_NAMES.catalog]
      .map((name) => skippedCheck(name, UNREADABLE_LAYOUT)),
  ])
}
