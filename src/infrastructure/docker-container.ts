import type { CommandResult, CommandRunner } from './command-runner.ts'

export interface ContainerRun {
  dockerfile: string
  environment?: Record<string, string>
  volume?: { container: string, host: string }
}

export class DockerUnavailableError extends Error {
  override name = 'DockerUnavailableError'
}

const PLATFORM = 'linux/amd64'
const TRAILING_LINES = 20

export function imageOf(dockerfile: string): string {
  const image = /^FROM\s+(\S+)/m.exec(dockerfile)?.[1]
  if (!image) {
    throw new Error('the Dockerfile of a validator names no image')
  }
  return image
}

export function outputLines(output: string): string[] {
  return output.split(/\r?\n/).filter((line) => line.trim() !== '')
}

export async function runContainer(runner: CommandRunner, run: ContainerRun): Promise<CommandResult> {
  const environment = run.environment ?? {}
  const argumentList = [
    'run',
    '--rm',
    '--platform',
    PLATFORM,
    ...Object.keys(environment).flatMap((name) => ['--env', name]),
    ...run.volume ? ['--volume', `${run.volume.host}:${run.volume.container}`] : [],
    imageOf(run.dockerfile),
  ]
  let result: CommandResult
  try {
    result = await runner.run('docker', argumentList, { environment })
  } catch (error) {
    throw new DockerUnavailableError(`Docker could not start: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (result.exitCode !== 0 && /exec format error/.test(result.output)) {
    throw new DockerUnavailableError(`Docker on this machine cannot run ${PLATFORM} images`)
  }
  return result
}

export function trailingLinesOf(lines: readonly string[]): string {
  return lines.slice(-TRAILING_LINES).join('\n')
}
