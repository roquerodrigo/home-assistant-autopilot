export type CheckOutcome = 'failed' | 'passed' | 'skipped'

export interface Finding {
  file?: string
  message: string
  severity: 'error' | 'warning'
}

export interface ValidationCheck {
  findings: readonly Finding[]
  name: string
  outcome: CheckOutcome
  summary: string
}

export const VALIDATION_REFERENCE = 'https://contributors.home-assistant.io/marketplace/reference/validation/'

const OUTCOME_LABEL: Record<CheckOutcome, string> = {
  failed: '❌ Failed',
  passed: '✅ Passed',
  skipped: '⏭️ Skipped',
}

export class ValidationReport {
  readonly checks: readonly ValidationCheck[]

  get failed(): boolean {
    return this.checks.some((check) => check.outcome === 'failed')
  }

  constructor(checks: readonly ValidationCheck[]) {
    this.checks = checks
  }

  toMarkdown(title: string): string {
    const rows = this.checks.map((check) => `| ${check.name} | ${OUTCOME_LABEL[check.outcome]} | ${escapeCell(check.summary)} |`)
    const details = this.checks
      .filter((check) => check.findings.length > 0)
      .map((check) => [`### ${check.name}`, '', ...check.findings.map(markdownFinding)].join('\n'))
    return [
      `## ${title}`,
      '',
      '| Check | Result | Details |',
      '| --- | --- | --- |',
      ...rows,
      ...details.flatMap((detail) => ['', detail]),
      '',
      `The checks are described in the [Home Assistant Marketplace reference](${VALIDATION_REFERENCE}).`,
      '',
    ].join('\n')
  }

  toText(): string {
    return this.checks
      .flatMap((check) => [
        `${OUTCOME_LABEL[check.outcome]}  ${check.name}: ${check.summary}`,
        ...check.findings.map((finding) => `    ${finding.severity}: ${locatedMessage(finding)}`),
      ])
      .join('\n')
      .concat('\n')
  }
}

export function concludedCheck(name: string, findings: readonly Finding[], passedSummary: string): ValidationCheck {
  const errors = findings.filter((finding) => finding.severity === 'error').length
  const warnings = findings.length - errors
  if (errors > 0) {
    return { findings, name, outcome: 'failed', summary: countOf(errors, 'problem') }
  }
  const summary = warnings > 0 ? `${passedSummary}, with ${countOf(warnings, 'warning')}` : passedSummary
  return { findings, name, outcome: 'passed', summary }
}

export function skippedCheck(name: string, reason: string): ValidationCheck {
  return { findings: [], name, outcome: 'skipped', summary: reason }
}

function countOf(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

function escapeCell(text: string): string {
  return text.replaceAll('|', '\\|').replaceAll('\n', ' ')
}

function locatedMessage(finding: Finding): string {
  return finding.file ? `${finding.file}: ${finding.message}` : finding.message
}

function markdownFinding(finding: Finding): string {
  return `- ${finding.severity === 'error' ? '**Error**' : 'Warning'}: ${finding.file ? `\`${finding.file}\`: ` : ''}${finding.message}`
}
