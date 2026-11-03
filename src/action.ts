import * as core from '@actions/core'
import { randomUUID } from 'node:crypto'

import type { Reporter } from './application/ports.ts'
import type { CommandRunner } from './infrastructure/command-runner.ts'

import { HomeAssistantAutopilot } from './home-assistant-autopilot.ts'

export interface ActionDependencies {
  fetch?: typeof fetch
  runner?: CommandRunner
}

const SUMMARY_TITLE = 'Home Assistant Marketplace'

const reporter: Reporter = {
  group: (title, lines) => {
    const resumeToken = randomUUID()
    core.startGroup(title)
    core.info(`::stop-commands::${resumeToken}`)
    for (const line of lines) {
      core.info(line)
    }
    core.info(`::${resumeToken}::`)
    core.endGroup()
  },
  info: (message) => core.info(message),
  warning: (message) => core.warning(message),
}

export async function runAction(dependencies: ActionDependencies = {}): Promise<void> {
  const command = core.getInput('command') || 'validate'
  const autopilot = new HomeAssistantAutopilot({
    directory: process.env.GITHUB_WORKSPACE,
    fetch: dependencies.fetch,
    reporter,
    repository: core.getInput('repository', { required: true }),
    runner: dependencies.runner,
    token: core.getInput('token', { required: true }),
  })
  if (command === 'validate') {
    return validate(autopilot)
  }
  if (command === 'publish') {
    return publish(autopilot, core.getInput('tag', { required: true }))
  }
  throw new Error(`command must be validate or publish, not "${command}"`)
}

async function publish(autopilot: HomeAssistantAutopilot, tag: string): Promise<void> {
  const { asset, domain, project } = await autopilot.publish(tag)
  core.setOutput('category', project.category)
  core.setOutput('domain', domain ?? '')
  core.setOutput('asset', asset?.name ?? '')
  core.setOutput('asset-url', asset?.url ?? '')
  const line = asset ? `Attached [\`${asset.name}\`](${asset.url}) to ${tag}.` : `${tag} needs no asset.`
  await core.summary.addRaw(`## ${SUMMARY_TITLE}\n\n${line}\n`).write()
}

async function validate(autopilot: HomeAssistantAutopilot): Promise<void> {
  const { domain, project, report } = await autopilot.validate()
  core.setOutput('category', project?.category ?? '')
  core.setOutput('domain', domain ?? '')
  for (const check of report.checks) {
    for (const finding of check.findings) {
      const annotate = finding.severity === 'error' ? core.error : core.warning
      annotate(finding.message, { file: finding.file, title: check.name })
    }
  }
  await core.summary.addRaw(report.toMarkdown(SUMMARY_TITLE)).write()
  const failed = report.checks.filter((check) => check.outcome === 'failed').map((check) => check.name)
  if (failed.length > 0) {
    core.setFailed(`Failed: ${failed.join(', ')}`)
  }
}
