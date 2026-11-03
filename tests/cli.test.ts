import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { afterEach, describe, it } from 'node:test'

import { runCommandLine } from '../src/cli.ts'
import { HomeAssistantAutopilot } from '../src/home-assistant-autopilot.ts'
import { fakeGitHub } from './fake-github.ts'
import { checkoutOf, DASHBOARD, INTEGRATION, runnerWithDocker, withFiles } from './support.ts'

const ENVIRONMENT = { GITHUB_REPOSITORY: 'owner/example', GITHUB_TOKEN: 'token' }

describe('the command line', () => {
  const checkouts: string[] = []

  afterEach(() => {
    for (const checkout of checkouts.splice(0)) {
      rmSync(checkout, { force: true, recursive: true })
    }
  })

  const run = async (argumentList: string[], environment: Record<string, string | undefined> = ENVIRONMENT, files = INTEGRATION) => {
    const written: string[] = []
    const errors: string[] = []
    const runner = runnerWithDocker(() => ({ exitCode: 0, output: '<Validation topics> completed' }))
    const exitCode = await runCommandLine(argumentList, environment, {
      error: (text) => errors.push(text),
      write: (text) => written.push(text),
    }, { fetch: fakeGitHub({ files, releases: [{ id: 1, tag: 'v1.2.0' }] }), runner })
    return { errors: errors.join(''), exitCode, runner, written: written.join('') }
  }

  const checkout = (tree = INTEGRATION) => {
    const directory = checkoutOf(tree)
    checkouts.push(directory)
    return directory
  }

  it('prints the usage', async () => {
    const { exitCode, written } = await run(['--help'])
    assert.equal(exitCode, 0)
    assert.match(written, /^Usage: home-assistant-autopilot <command>/)
    assert.equal((await run([])).exitCode, 1)
  })

  it('validates a checkout and prints the report', async () => {
    const directory = checkout()
    const { errors, exitCode, runner, written } = await run(['validate', '--directory', directory, '--ref', 'abc'])
    assert.equal(exitCode, 0)
    assert.match(written, /✅ Passed {2}Layout: Integration `example`/)
    assert.match(errors, /^Hassfest:\n {2}<Validation topics> completed\n/m)
    assert.equal(runner.commands.find((command) => command.options?.environment?.REPOSITORY_REF)?.options?.environment?.REPOSITORY_REF, 'abc')
  })

  it('exits with 1 when a check fails', async () => {
    const directory = checkout(withFiles(DASHBOARD, { 'hacs.json': '{"filename":"example-card.js"}' }))
    const { exitCode, written } = await run(['validate', '--directory', directory])
    assert.equal(exitCode, 1)
    assert.match(written, /error: hacs.json: `name` is required/)
  })

  it('publishes a tag and prints the outcome as JSON', async () => {
    const { exitCode, written } = await run(['publish', '--tag', 'v1.2.0', '--repository', 'owner/example'], { GH_TOKEN: 'token' })
    assert.equal(exitCode, 0)
    assert.deepEqual(JSON.parse(written), {
      asset: 'example.zip',
      assetUrl: 'https://github.com/owner/example/releases/download/tag/example.zip',
      category: 'integration',
      domain: 'example',
    })
  })

  it('publishes nothing for a theme', async () => {
    const { exitCode, written } = await run(['publish', '--tag', 'v1.2.0'], ENVIRONMENT, { 'hacs.json': '{"name":"T"}', 'themes/a.yaml': '' })
    assert.equal(exitCode, 0)
    assert.deepEqual(JSON.parse(written), { asset: null, assetUrl: null, category: 'theme', domain: null })
  })

  it('reports what it needs', async () => {
    assert.match((await run(['publish'])).errors, /^home-assistant-autopilot: publish needs --tag\n$/)
    assert.match((await run(['validate'], {})).errors, /set --repository or GITHUB_REPOSITORY/)
    assert.match((await run(['validate'], { GITHUB_REPOSITORY: 'owner/example' })).errors, /set GITHUB_TOKEN or GH_TOKEN/)
    assert.match((await run(['deploy'])).errors, /unknown command "deploy"/)
    assert.match((await run(['validate', 'more'])).errors, /unknown command "validate more"/)
    assert.match((await run(['--nope'])).errors, /Unknown option '--nope'/)
  })

  it('reports a release the versions disagree with', async () => {
    const { errors, exitCode } = await run(['publish', '--tag', 'v9'])
    assert.equal(exitCode, 1)
    assert.match(errors, /v9 releases 9, but custom_components\/example\/manifest.json declares 1.2.0/)
  })
})

describe('the library', () => {
  it('refuses a repository that is not owner/name, and a missing token', () => {
    assert.throws(() => new HomeAssistantAutopilot({ repository: 'example', token: 'token' }), /owner\/name, not "example"/)
    assert.throws(() => new HomeAssistantAutopilot({ repository: 'owner/example', token: '' }), /token is required/)
  })

  it('needs a tag to publish', () => {
    assert.throws(() => new HomeAssistantAutopilot({ repository: 'owner/example', token: 'token' }).publish(''), /needs the tag/)
  })
})
