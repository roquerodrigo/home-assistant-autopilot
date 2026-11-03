import { Octokit } from '@octokit/rest'

import type { Reporter } from './application/ports.ts'
import type { PublishOutcome } from './application/publish-release-asset.ts'
import type { ValidationOutcome } from './application/validate-project.ts'
import type { CommandRunner } from './infrastructure/command-runner.ts'

import { PublishReleaseAsset } from './application/publish-release-asset.ts'
import { ValidateProject } from './application/validate-project.ts'
import { CatalogValidator } from './infrastructure/catalog-validator.ts'
import { ProcessCommandRunner } from './infrastructure/command-runner.ts'
import { GitHubProjectSource } from './infrastructure/github-project-source.ts'
import { GitHubReleaseAssetUploader } from './infrastructure/github-release-asset-uploader.ts'
import { GitHubRepositoryDirectory } from './infrastructure/github-repository-directory.ts'
import { HassfestValidator } from './infrastructure/hassfest-validator.ts'
import { LocalProjectSource } from './infrastructure/local-project-source.ts'
import { ZipArchiver } from './infrastructure/zip-archiver.ts'

export interface HomeAssistantAutopilotOptions {
  directory?: string
  fetch?: typeof fetch
  ref?: string
  reporter?: Reporter
  repository: string
  runner?: CommandRunner
  token: string
}

const consoleReporter: Reporter = {
  group: (title, lines) => console.info([`${title}:`, ...lines.map((line) => `  ${line}`)].join('\n')),
  info: (message) => console.info(message),
  warning: (message) => console.warn(message),
}

export class HomeAssistantAutopilot {
  private readonly directory: GitHubRepositoryDirectory
  private readonly octokit: Octokit
  private readonly options: HomeAssistantAutopilotOptions
  private readonly reporter: Reporter
  private readonly runner: CommandRunner

  constructor(options: HomeAssistantAutopilotOptions) {
    if (!/^[^/\s]+\/[^/\s]+$/.test(options.repository)) {
      throw new Error(`The repository must be given as owner/name, not "${options.repository}"`)
    }
    if (!options.token) {
      throw new Error('token is required')
    }
    this.options = options
    this.reporter = options.reporter ?? consoleReporter
    this.runner = options.runner ?? new ProcessCommandRunner()
    this.octokit = new Octokit({
      auth: options.token,
      log: { debug() {}, error() {}, info() {}, warn() {} },
      request: { fetch: options.fetch },
    })
    this.directory = new GitHubRepositoryDirectory(this.octokit, options.repository)
  }

  publish(tag: string): Promise<PublishOutcome> {
    if (!tag) {
      throw new Error('publish needs the tag of the release')
    }
    const { repository } = this.options
    return new PublishReleaseAsset({
      archiver: new ZipArchiver(),
      directory: this.directory,
      reporter: this.reporter,
      sourceAt: (ref) => new GitHubProjectSource(this.octokit, repository, ref),
      uploader: new GitHubReleaseAssetUploader(this.octokit, repository),
    }).run(tag)
  }

  async validate(): Promise<ValidationOutcome> {
    const { repository, token } = this.options
    const checkout = this.options.directory ?? process.cwd()
    const source = new LocalProjectSource(checkout, this.runner)
    const ref = this.options.ref ?? await source.headCommit()
    return new ValidateProject({
      catalog: new CatalogValidator(this.runner, { ref, repository, token }, this.reporter),
      directory: this.directory,
      hassfest: new HassfestValidator(this.runner, checkout, this.reporter),
      source,
    }).run()
  }
}
