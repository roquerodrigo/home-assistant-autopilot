import type { ExternalValidator, Reporter } from '../application/ports.ts'
import type { HomeAssistantProject } from '../domain/home-assistant-project.ts'
import type { ProjectCategory } from '../domain/project-category.ts'
import type { CommandRunner } from './command-runner.ts'

import dockerfile from '../../images/catalog.Dockerfile'
import { CHECK_NAMES } from '../domain/project-checks.ts'
import { concludedCheck, type Finding, type ValidationCheck } from '../domain/validation-report.ts'
import { DockerUnavailableError, outputLines, runContainer, trailingLinesOf } from './docker-container.ts'

export interface CatalogTarget {
  ref: string
  repository: string
  token: string
}

const VALIDATOR_CATEGORY: Record<ProjectCategory, string> = {
  dashboard: 'plugin',
  integration: 'integration',
  template: 'template',
  theme: 'theme',
}

const COMPLETED = /<Validation (\w+)> completed/
const FAILED = /<Validation (\w+)> failed:\s+(.*?)\s*(?:\(More info: [^)]*\))?\s*$/
const LOGGED_ERROR = /^::(?:ERROR|CRITICAL)::\s*(.*)$/
const FAILURE_TALLY = /\d+\/\d+ checks failed$/

export class CatalogValidator implements ExternalValidator {
  private readonly reporter: Reporter
  private readonly runner: CommandRunner
  private readonly target: CatalogTarget

  constructor(runner: CommandRunner, target: CatalogTarget, reporter: Reporter) {
    this.reporter = reporter
    this.runner = runner
    this.target = target
  }

  async validate(project: HomeAssistantProject): Promise<ValidationCheck> {
    const { ref, repository, token } = this.target
    let result
    try {
      result = await runContainer(this.runner, {
        dockerfile,
        environment: {
          CATEGORY: VALIDATOR_CATEGORY[project.category],
          INPUT_GITHUB_TOKEN: token,
          INPUT_REPOSITORY: repository,
          REPOSITORY: repository,
          REPOSITORY_REF: ref,
        },
      })
    } catch (error) {
      if (error instanceof DockerUnavailableError) {
        return concludedCheck(CHECK_NAMES.catalog, [{ message: error.message, severity: 'error' }], '')
      }
      throw error
    }
    const lines = outputLines(result.output)
    this.reporter.group(CHECK_NAMES.catalog, lines)
    const findings: Finding[] = lines.flatMap((line) => findingOf(line) ?? [])
    if (result.exitCode !== 0 && findings.length === 0) {
      findings.push({ message: `The catalog checks exited with ${result.exitCode}: ${trailingLinesOf(lines)}`, severity: 'error' })
    }
    const completed = lines.filter((line) => COMPLETED.test(line)).length
    return concludedCheck(CHECK_NAMES.catalog, findings, `${completed} check${completed === 1 ? '' : 's'} passed`)
  }
}

function findingOf(line: string): Finding | undefined {
  const failed = FAILED.exec(line)
  if (failed) {
    return { message: `${failed[1]}: ${failed[2]}`, severity: 'error' }
  }
  const logged = LOGGED_ERROR.exec(line)?.[1]
  if (logged && !FAILURE_TALLY.test(logged)) {
    return { message: logged, severity: 'error' }
  }
  return undefined
}
