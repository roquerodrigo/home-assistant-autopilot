import { parseArgs } from 'node:util'

import type { Reporter } from './application/ports.ts'
import type { CommandRunner } from './infrastructure/command-runner.ts'

import { HomeAssistantAutopilot } from './home-assistant-autopilot.ts'

export interface CommandLineDependencies {
  fetch?: typeof fetch
  runner?: CommandRunner
}

export interface CommandLineOutput {
  error(text: string): void
  write(text: string): void
}

const USAGE = `Usage: home-assistant-autopilot <command> [options]

Commands:
  validate                    Checks a checkout for the Home Assistant Marketplace. Hassfest
                              and the catalog checks run in Docker, on linux/amd64.
  publish                     Attaches the release asset of an integration or a dashboard
                              module to the release of --tag. Prints the outcome as JSON.

Options:
  --repository <owner/name>   Repository on GitHub. Defaults to GITHUB_REPOSITORY.
  --directory <path>          validate: the checkout. Defaults to the current directory.
  --ref <commit>              validate: the pushed commit the catalog checks read. Defaults
                              to the commit checked out.
  --tag <tag>                 publish: tag of the release.
  --help                      Prints this text.

Environment:
  GITHUB_TOKEN or GH_TOKEN    Token that reads the repository, and for publish writes its
                              releases.
`

export async function runCommandLine(
  argumentList: readonly string[],
  environment: Record<string, string | undefined>,
  output: CommandLineOutput,
  dependencies: CommandLineDependencies = {},
): Promise<number> {
  try {
    const { positionals, values } = parseArgs({
      allowPositionals: true,
      args: [...argumentList],
      options: {
        directory: { type: 'string' },
        help: { type: 'boolean' },
        ref: { type: 'string' },
        repository: { type: 'string' },
        tag: { type: 'string' },
      },
      strict: true,
    })
    const [command, ...extra] = positionals
    if (values.help || !command) {
      output.write(USAGE)
      return values.help ? 0 : 1
    }
    if (extra.length > 0 || !['publish', 'validate'].includes(command)) {
      throw new Error(`unknown command "${positionals.join(' ')}"; run with --help`)
    }
    const autopilot = new HomeAssistantAutopilot({
      directory: values.directory,
      fetch: dependencies.fetch,
      ref: values.ref,
      reporter: reporterOn(output),
      repository: values.repository ?? required(environment, 'GITHUB_REPOSITORY', '--repository'),
      runner: dependencies.runner,
      token: environment.GITHUB_TOKEN || required(environment, 'GH_TOKEN', 'GITHUB_TOKEN'),
    })
    if (command === 'publish') {
      if (!values.tag) {
        throw new Error('publish needs --tag')
      }
      const { asset, domain, project } = await autopilot.publish(values.tag)
      output.write(`${JSON.stringify({
        asset: asset?.name ?? null,
        assetUrl: asset?.url ?? null,
        category: project.category,
        domain: domain ?? null,
      })}\n`)
      return 0
    }
    const { report } = await autopilot.validate()
    output.write(report.toText())
    return report.failed ? 1 : 0
  } catch (error) {
    output.error(`home-assistant-autopilot: ${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}

function reporterOn(output: CommandLineOutput): Reporter {
  return {
    group: (title, lines) => output.error([`${title}:`, ...lines.map((line) => `  ${line}`), ''].join('\n')),
    info: (message) => output.error(`${message}\n`),
    warning: (message) => output.error(`warning: ${message}\n`),
  }
}

function required(environment: Record<string, string | undefined>, name: string, alternative?: string): string {
  const value = environment[name]
  if (!value) {
    throw new Error(`set ${alternative ? `${alternative} or ${name}` : name}`)
  }
  return value
}
