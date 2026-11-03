import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import type { ExternalValidator, ProjectSource, Reporter, RepositoryDescription, RepositoryDirectory } from '../src/application/ports.ts'
import type { HomeAssistantProject } from '../src/domain/home-assistant-project.ts'
import type { ProjectFile } from '../src/domain/project-file.ts'
import type { CommandOptions, CommandResult, CommandRunner } from '../src/infrastructure/command-runner.ts'

import { concludedCheck, type ValidationCheck } from '../src/domain/validation-report.ts'
import { ProcessCommandRunner } from '../src/infrastructure/command-runner.ts'

export type FileTree = Record<string, string>

export const INTEGRATION: FileTree = {
  'custom_components/example/__init__.py': '',
  'custom_components/example/manifest.json': JSON.stringify({ domain: 'example', name: 'Example', version: '1.2.0' }),
  'custom_components/example/translations/en.json': '{}',
  'hacs.json': JSON.stringify({ filename: 'example.zip', name: 'Example', zip_release: true }),
  'pyproject.toml': '[project]\nname = "example"\nversion = "1.2.0"\n',
  'README.md': '# Example',
}

export const DASHBOARD: FileTree = {
  'example-card.js': 'customElements.define("example-card", class extends HTMLElement {})',
  'hacs.json': JSON.stringify({ filename: 'example-card.js', name: 'Example card' }),
}

export interface RecordedCommand {
  argumentList: readonly string[]
  command: string
  options: CommandOptions | undefined
}

export class FixedDirectory implements RepositoryDirectory {
  readonly description: RepositoryDescription

  constructor(description: Partial<RepositoryDescription> = {}) {
    this.description = { name: 'example', private: false, ...description }
  }

  async describe(): Promise<RepositoryDescription> {
    return this.description
  }
}

export class MemoryProjectSource implements ProjectSource {
  readonly tree: FileTree

  constructor(tree: FileTree) {
    this.tree = tree
  }

  async files(): Promise<ProjectFile[]> {
    return filesOf(this.tree)
  }

  async read(path: string): Promise<Uint8Array | undefined> {
    const content = this.tree[path]
    return content === undefined ? undefined : Buffer.from(content)
  }
}

export class PassingValidator implements ExternalValidator {
  readonly name: string
  validated: HomeAssistantProject[] = []

  constructor(name: string) {
    this.name = name
  }

  async validate(project: HomeAssistantProject): Promise<ValidationCheck> {
    this.validated.push(project)
    return concludedCheck(this.name, [], 'Fine')
  }
}

export class RecordingReporter implements Reporter {
  readonly groups: { lines: readonly string[], title: string }[] = []
  readonly messages: string[] = []
  readonly warnings: string[] = []

  group(title: string, lines: readonly string[]): void {
    this.groups.push({ lines, title })
  }

  info(message: string): void {
    this.messages.push(message)
  }

  warning(message: string): void {
    this.warnings.push(message)
  }
}

export class ScriptedRunner implements CommandRunner {
  readonly answer: (command: string, argumentList: readonly string[]) => CommandResult | Error
  readonly commands: RecordedCommand[] = []

  constructor(answer: (command: string, argumentList: readonly string[]) => CommandResult | Error) {
    this.answer = answer
  }

  async run(command: string, argumentList: readonly string[], options?: CommandOptions): Promise<CommandResult> {
    this.commands.push({ argumentList, command, options })
    const result = this.answer(command, argumentList)
    if (result instanceof Error) {
      throw result
    }
    return result
  }
}

export function checkoutOf(tree: FileTree): string {
  const directory = mkdtempSync(join(tmpdir(), 'home-assistant-autopilot-'))
  for (const [path, content] of Object.entries(tree)) {
    mkdirSync(dirname(join(directory, path)), { recursive: true })
    writeFileSync(join(directory, path), content)
  }
  const git = (...argumentList: string[]) => execFileSync('git', argumentList, { cwd: directory, stdio: 'pipe' })
  git('init', '--quiet')
  git('add', '.')
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '--quiet', '--message', 'test')
  return directory
}

export function filesOf(tree: FileTree): ProjectFile[] {
  return Object.entries(tree).map(([path, content]) => ({ path, size: Buffer.byteLength(content) }))
}

export function runnerWithDocker(answer: (argumentList: readonly string[]) => CommandResult): CommandRunner & ScriptedRunner {
  const real = new ProcessCommandRunner()
  const runner = new ScriptedRunner((_, argumentList) => answer(argumentList))
  const scripted = runner.run.bind(runner)
  runner.run = (command, argumentList, options) => command === 'docker' ? scripted(command, argumentList, options) : real.run(command, argumentList, options)
  return runner
}

export function withFiles(tree: FileTree, changes: Record<string, string | undefined>): FileTree {
  const changed: FileTree = { ...tree }
  for (const [path, content] of Object.entries(changes)) {
    if (content === undefined) {
      delete changed[path]
    } else {
      changed[path] = content
    }
  }
  return changed
}
