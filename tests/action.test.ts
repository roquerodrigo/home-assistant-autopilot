import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, afterEach, before, beforeEach, describe, it } from 'node:test'

import { runAction } from '../src/action.ts'
import { fakeGitHub, type FakeRepository } from './fake-github.ts'
import { checkoutOf, DASHBOARD, type FileTree, INTEGRATION, runnerWithDocker, withFiles } from './support.ts'

const INPUTS: Record<string, string> = {
  INPUT_COMMAND: 'validate',
  INPUT_REPOSITORY: 'owner/example',
  INPUT_TAG: '',
  INPUT_TOKEN: 'token',
}
const CATALOG_PASSED = '::INFO:: <Validation topics> completed\n'

describe('the action', () => {
  let checkout: string | undefined
  let directory: string
  let outputFile: string
  let summaryFile: string
  let written: string[]

  before(() => {
    directory = mkdtempSync(join(tmpdir(), 'home-assistant-autopilot-'))
    outputFile = join(directory, 'output')
    summaryFile = join(directory, 'summary')
  })

  after(() => {
    rmSync(directory, { recursive: true })
  })

  beforeEach(() => {
    checkout = undefined
    process.exitCode = undefined
    writeFileSync(outputFile, '')
    writeFileSync(summaryFile, '')
    Object.assign(process.env, INPUTS, { GITHUB_OUTPUT: outputFile, GITHUB_STEP_SUMMARY: summaryFile })
    written = []
  })

  afterEach(() => {
    if (checkout) {
      rmSync(checkout, { force: true, recursive: true })
    }
    for (const name of [...Object.keys(INPUTS), 'GITHUB_OUTPUT', 'GITHUB_STEP_SUMMARY', 'GITHUB_WORKSPACE']) {
      delete process.env[name]
    }
    process.exitCode = undefined
  })

  const run = async (dependencies: Parameters<typeof runAction>[0]) => {
    const write = process.stdout.write
    process.stdout.write = ((chunk: string | Uint8Array, ...rest: never[]) =>
      typeof chunk === 'string' ? written.push(chunk) > 0 : write.call(process.stdout, chunk, ...rest)) as typeof process.stdout.write
    try {
      await runAction(dependencies)
    } finally {
      process.stdout.write = write
    }
  }

  const output = (name: string) =>
    new RegExp(`^${name}<<(\\S+)\\n([^]*?)\\n?\\1$`, 'm').exec(readFileSync(outputFile, 'utf8'))?.[2]

  const validate = async (tree: FileTree, hassfestOutput = 'Validating', repository: FakeRepository = {}) => {
    checkout = checkoutOf(tree)
    process.env.GITHUB_WORKSPACE = checkout
    const runner = runnerWithDocker((argumentList) => argumentList.some((argument) => argument.includes('hassfest')) ?
        { exitCode: hassfestOutput.includes('[ERROR]') ? 1 : 0, output: hassfestOutput } :
        { exitCode: 0, output: CATALOG_PASSED })
    await run({ fetch: fakeGitHub(repository), runner })
    return runner
  }

  it('validates the workspace and writes the summary', async () => {
    const runner = await validate(INTEGRATION)
    assert.equal(process.exitCode, undefined)
    assert.equal(output('category'), 'integration')
    assert.equal(output('domain'), 'example')
    assert.match(readFileSync(summaryFile, 'utf8'), /\| Hassfest \| ✅ Passed \|/)
    assert.equal(runner.commands.filter((command) => command.command === 'docker').length, 2)
    const catalog = runner.commands.find((command) => command.options?.environment?.CATEGORY)
    assert.match(catalog!.options!.environment!.REPOSITORY_REF, /^[0-9a-f]{40}$/)
  })

  it('stops workflow commands in the output of a validator', async () => {
    await validate(INTEGRATION, '::error::not an annotation')
    const lines = written.join('').split('\n')
    const stop = lines.findIndex((line) => line.startsWith('::stop-commands::'))
    const resume = lines.findIndex((line, index) => index > stop && line === `::${lines[stop].slice('::stop-commands::'.length)}::`)
    const echoed = lines.indexOf('::error::not an annotation')
    assert.ok(stop < echoed && echoed < resume)
  })

  it('annotates the findings and fails the step', async () => {
    await validate(withFiles(INTEGRATION, { 'hacs.json': '{"name":"Example","zip_release":true,"filename":"example.zip","hacs":"2"}' }), ' * [ERROR] [MANIFEST] Bad')
    assert.equal(process.exitCode, 1)
    const log = written.join('')
    assert.match(log, /::error title=Hassfest,file=custom_components\/example\/manifest.json::\[MANIFEST\] Bad/)
    assert.match(log, /::warning title=hacs.json,file=hacs.json::`hacs` can be removed/)
    assert.match(log, /::error::Failed: Hassfest/)
  })

  it('skips the catalog checks of a private repository', async () => {
    const runner = await validate(DASHBOARD, '', { private: true })
    assert.equal(process.exitCode, undefined)
    assert.equal(output('category'), 'dashboard')
    assert.equal(output('domain'), '')
    assert.equal(runner.commands.filter((command) => command.command === 'docker').length, 0)
  })

  it('reports a repository it cannot read', async () => {
    await validate({ 'README.md': '' })
    assert.equal(process.exitCode, 1)
    assert.equal(output('category'), '')
  })

  it('publishes the asset of a tag', async () => {
    process.env.INPUT_COMMAND = 'publish'
    process.env.INPUT_TAG = 'v1.2.0'
    await run({ fetch: fakeGitHub({ files: INTEGRATION, releases: [{ id: 1, tag: 'v1.2.0' }] }) })
    assert.equal(output('category'), 'integration')
    assert.equal(output('domain'), 'example')
    assert.equal(output('asset'), 'example.zip')
    assert.equal(output('asset-url'), 'https://github.com/owner/example/releases/download/tag/example.zip')
    assert.match(readFileSync(summaryFile, 'utf8'), /Attached \[`example.zip`\]\(https:\/\/github.com\/owner\/example\/releases\/download\/tag\/example.zip\) to v1.2.0/)
  })

  it('publishes nothing for a theme', async () => {
    process.env.INPUT_COMMAND = 'publish'
    process.env.INPUT_TAG = 'v1'
    await run({ fetch: fakeGitHub({ files: { 'hacs.json': '{"name":"T"}', 'themes/a.yaml': '' } }) })
    assert.equal(output('asset'), '')
    assert.equal(output('domain'), '')
    assert.match(readFileSync(summaryFile, 'utf8'), /v1 needs no asset/)
  })

  it('needs a tag to publish', async () => {
    process.env.INPUT_COMMAND = 'publish'
    await assert.rejects(run({ fetch: fakeGitHub({}) }), /Input required and not supplied: tag/)
  })

  it('refuses an unknown command', async () => {
    process.env.INPUT_COMMAND = 'deploy'
    await assert.rejects(run({ fetch: fakeGitHub({}) }), /command must be validate or publish, not "deploy"/)
  })

  it('validates by default', async () => {
    process.env.INPUT_COMMAND = ''
    await validate(DASHBOARD)
    assert.equal(output('category'), 'dashboard')
  })
})
