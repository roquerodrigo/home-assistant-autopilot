import { resolve } from 'node:path'

import type { ExternalValidator, Reporter } from '../application/ports.ts'
import type { HomeAssistantProject } from '../domain/home-assistant-project.ts'
import type { CommandRunner } from './command-runner.ts'

import dockerfile from '../../images/hassfest.Dockerfile'
import { CHECK_NAMES } from '../domain/project-checks.ts'
import { concludedCheck, type Finding, type ValidationCheck } from '../domain/validation-report.ts'
import { DockerUnavailableError, outputLines, runContainer, trailingLinesOf } from './docker-container.ts'

const REPORTED_PROBLEM = /^\s*\*\s\[(ERROR|WARNING)\]\s(.*)$/

export class HassfestValidator implements ExternalValidator {
  private readonly directory: string
  private readonly reporter: Reporter
  private readonly runner: CommandRunner

  constructor(runner: CommandRunner, directory: string, reporter: Reporter) {
    this.directory = directory
    this.reporter = reporter
    this.runner = runner
  }

  async validate(project: HomeAssistantProject): Promise<ValidationCheck> {
    let result
    try {
      result = await runContainer(this.runner, {
        dockerfile,
        volume: { container: '/github/workspace', host: resolve(this.directory) },
      })
    } catch (error) {
      if (error instanceof DockerUnavailableError) {
        return concludedCheck(CHECK_NAMES.hassfest, [{ message: error.message, severity: 'error' }], '')
      }
      throw error
    }
    const lines = outputLines(result.output)
    this.reporter.group(CHECK_NAMES.hassfest, lines)
    const findings: Finding[] = lines.flatMap((line) => {
      const [, severity, message] = REPORTED_PROBLEM.exec(line) ?? []
      return severity ? [{ file: project.integrationManifestPath, message, severity: severity === 'ERROR' ? 'error' : 'warning' }] : []
    })
    if (result.exitCode !== 0 && !findings.some((finding) => finding.severity === 'error')) {
      findings.push({ message: `Hassfest exited with ${result.exitCode}: ${trailingLinesOf(lines)}`, severity: 'error' })
    }
    return concludedCheck(CHECK_NAMES.hassfest, findings, 'The integration is valid')
  }
}
