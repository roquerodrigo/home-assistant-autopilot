import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

import type { ProjectSource } from '../application/ports.ts'
import type { ProjectFile } from '../domain/project-file.ts'
import type { CommandRunner } from './command-runner.ts'

export class LocalProjectSource implements ProjectSource {
  private readonly directory: string
  private readonly runner: CommandRunner

  constructor(directory: string, runner: CommandRunner) {
    this.directory = directory
    this.runner = runner
  }

  async files(): Promise<ProjectFile[]> {
    const paths = (await this.git('ls-files', '-z')).split('\0').filter(Boolean)
    const files = await Promise.all(paths.map(async (path) => {
      const status = await stat(join(this.directory, path)).catch(() => undefined)
      return status?.isFile() ? { path, size: status.size } : undefined
    }))
    return files.filter((file) => file !== undefined)
  }

  async headCommit(): Promise<string> {
    return (await this.git('rev-parse', 'HEAD')).trim()
  }

  async read(path: string): Promise<Uint8Array | undefined> {
    return readFile(join(this.directory, path)).catch(() => undefined)
  }

  private async git(...argumentList: string[]): Promise<string> {
    const { exitCode, output } = await this.runner.run('git', argumentList, { directory: this.directory })
    if (exitCode !== 0) {
      throw new Error(`${this.directory} is not a Git checkout: ${output.trim()}`)
    }
    return output
  }
}
