import { spawn } from 'node:child_process'

export interface CommandOptions {
  directory?: string
  environment?: Record<string, string>
}

export interface CommandResult {
  exitCode: number
  output: string
}

export interface CommandRunner {
  run(command: string, argumentList: readonly string[], options?: CommandOptions): Promise<CommandResult>
}

export class ProcessCommandRunner implements CommandRunner {
  run(command: string, argumentList: readonly string[], options: CommandOptions = {}): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, argumentList, {
        cwd: options.directory,
        env: { ...process.env, ...options.environment },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      const chunks: Buffer[] = []
      child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
      child.stderr.on('data', (chunk: Buffer) => chunks.push(chunk))
      child.on('error', reject)
      child.on('close', (exitCode) => resolve({ exitCode: exitCode ?? 1, output: Buffer.concat(chunks).toString('utf8') }))
    })
  }
}
