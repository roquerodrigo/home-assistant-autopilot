import { Octokit } from '@octokit/rest'
import { unzipSync } from 'fflate'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'

import { ReleaseAssetError } from '../src/domain/errors.ts'
import { detectProject } from '../src/domain/home-assistant-project.ts'
import { parseMarketplaceManifest } from '../src/domain/marketplace-manifest.ts'
import { CatalogValidator } from '../src/infrastructure/catalog-validator.ts'
import { ProcessCommandRunner } from '../src/infrastructure/command-runner.ts'
import { DockerUnavailableError, imageOf, runContainer } from '../src/infrastructure/docker-container.ts'
import { GitHubProjectSource } from '../src/infrastructure/github-project-source.ts'
import { GitHubReleaseAssetUploader } from '../src/infrastructure/github-release-asset-uploader.ts'
import { GitHubRepositoryDirectory } from '../src/infrastructure/github-repository-directory.ts'
import { HassfestValidator } from '../src/infrastructure/hassfest-validator.ts'
import { LocalProjectSource } from '../src/infrastructure/local-project-source.ts'
import { ZipArchiver } from '../src/infrastructure/zip-archiver.ts'
import { fakeGitHub, type FakeRepository, type RecordedRequest } from './fake-github.ts'
import { DASHBOARD, filesOf, INTEGRATION, RecordingReporter, ScriptedRunner } from './support.ts'

const integration = detectProject(filesOf(INTEGRATION), parseMarketplaceManifest(INTEGRATION['hacs.json']), 'example')
const dashboard = detectProject(filesOf(DASHBOARD), parseMarketplaceManifest(DASHBOARD['hacs.json']), 'example')

const octokitOn = (repository: FakeRepository, requests: RecordedRequest[] = []) =>
  new Octokit({ log: { debug() {}, error() {}, info() {}, warn() {} }, request: { fetch: fakeGitHub(repository, requests) } })

const answered = (exitCode: number, output: string) => new ScriptedRunner(() => ({ exitCode, output }))

describe('the process command runner', () => {
  const runner = new ProcessCommandRunner()

  it('returns the exit code and both output streams', async () => {
    const script = 'console.log(process.env.GREETING); console.error("to stderr"); process.exit(3)'
    const result = await runner.run(process.execPath, ['-e', script], { environment: { GREETING: 'hello' } })
    assert.equal(result.exitCode, 3)
    assert.match(result.output, /hello/)
    assert.match(result.output, /to stderr/)
  })

  it('rejects a command that cannot start', async () => {
    await assert.rejects(runner.run('a-command-that-does-not-exist', []), /ENOENT/)
  })
})

describe('the local project source', () => {
  let directory: string
  const git = (...argumentList: string[]) => execFileSync('git', argumentList, { cwd: directory, stdio: 'pipe' })

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'home-assistant-autopilot-'))
    git('init', '--quiet')
    mkdirSync(join(directory, 'custom_components/example'), { recursive: true })
    writeFileSync(join(directory, 'hacs.json'), '{"name":"Example"}')
    writeFileSync(join(directory, 'custom_components/example/manifest.json'), '{}')
    writeFileSync(join(directory, 'removed.txt'), 'gone')
    git('add', '.')
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '--quiet', '--message', 'test')
    unlinkSync(join(directory, 'removed.txt'))
    writeFileSync(join(directory, 'untracked.txt'), 'ignored')
  })

  afterEach(() => {
    rmSync(directory, { force: true, recursive: true })
  })

  it('lists the tracked files that exist, with their size', async () => {
    const source = new LocalProjectSource(directory, new ProcessCommandRunner())
    assert.deepEqual(await source.files(), [
      { path: 'custom_components/example/manifest.json', size: 2 },
      { path: 'hacs.json', size: 18 },
    ])
  })

  it('reads a file, and nothing for a file that is missing', async () => {
    const source = new LocalProjectSource(directory, new ProcessCommandRunner())
    assert.equal(Buffer.from((await source.read('hacs.json'))!).toString(), '{"name":"Example"}')
    assert.equal(await source.read('missing.json'), undefined)
  })

  it('tells the commit checked out', async () => {
    const source = new LocalProjectSource(directory, new ProcessCommandRunner())
    assert.equal(await source.headCommit(), git('rev-parse', 'HEAD').toString().trim())
  })

  it('refuses a directory that is not a Git checkout', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'home-assistant-autopilot-'))
    try {
      await assert.rejects(new LocalProjectSource(outside, new ProcessCommandRunner()).files(), /is not a Git checkout/)
    } finally {
      rmSync(outside, { force: true, recursive: true })
    }
  })
})

describe('running a container', () => {
  it('passes the environment by name and mounts the volume', async () => {
    const runner = answered(0, '')
    await runContainer(runner, {
      dockerfile: 'FROM image:1@sha256:abc\n',
      environment: { SECRET: 'value' },
      volume: { container: '/work', host: '/home/work' },
    })
    const [{ argumentList, command, options }] = runner.commands
    assert.equal(command, 'docker')
    assert.deepEqual(argumentList, ['run', '--rm', '--platform', 'linux/amd64', '--env', 'SECRET', '--volume', '/home/work:/work', 'image:1@sha256:abc'])
    assert.deepEqual(options?.environment, { SECRET: 'value' })
  })

  it('explains a machine that cannot run the image', async () => {
    await assert.rejects(runContainer(answered(1, 'exec /entrypoint.sh: exec format error'), { dockerfile: 'FROM a' }), DockerUnavailableError)
    await assert.rejects(runContainer(new ScriptedRunner(() => new Error('spawn docker ENOENT')), { dockerfile: 'FROM a' }), /Docker could not start: spawn docker ENOENT/)
    const throwingText = {
      run: async () => {
        throw 'down'
      },
    }
    await assert.rejects(runContainer(throwingText, { dockerfile: 'FROM a' }), /Docker could not start: down/)
  })

  it('reads the image of a Dockerfile', () => {
    assert.equal(imageOf('# pinned\nFROM ghcr.io/a/b:1@sha256:c\n'), 'ghcr.io/a/b:1@sha256:c')
    assert.throws(() => imageOf('RUN true'), /names no image/)
  })
})

describe('the hassfest validator', () => {
  const validate = (runner: ScriptedRunner, reporter = new RecordingReporter()) =>
    new HassfestValidator(runner, '/work/example', reporter).validate(integration)

  it('mounts the checkout as the workspace of the pinned image', async () => {
    const runner = answered(0, 'Validating integrations\n')
    const reporter = new RecordingReporter()
    const check = await validate(runner, reporter)
    assert.equal(check.outcome, 'passed')
    assert.equal(check.summary, 'The integration is valid')
    assert.ok(runner.commands[0].argumentList.includes('/work/example:/github/workspace'))
    assert.match(runner.commands[0].argumentList.at(-1)!, /^ghcr\.io\/home-assistant\/hassfest:[\d.]+@sha256:[0-9a-f]{64}$/)
    assert.deepEqual(reporter.groups, [{ lines: ['Validating integrations'], title: 'Hassfest' }])
  })

  it('turns the problems it reports into findings on the manifest', async () => {
    const check = await validate(answered(1, 'Integration example:\n * [ERROR] [MANIFEST] Invalid key\n * [WARNING] [TRANSLATIONS] Old\n'))
    assert.equal(check.outcome, 'failed')
    assert.deepEqual(check.findings, [
      { file: 'custom_components/example/manifest.json', message: '[MANIFEST] Invalid key', severity: 'error' },
      { file: 'custom_components/example/manifest.json', message: '[TRANSLATIONS] Old', severity: 'warning' },
    ])
  })

  it('fails with the end of the output when it reports nothing', async () => {
    const check = await validate(answered(2, 'Traceback\nKeyError\n'))
    assert.equal(check.findings[0].message, 'Hassfest exited with 2: Traceback\nKeyError')
  })

  it('fails when Docker is unavailable', async () => {
    const check = await validate(new ScriptedRunner(() => new Error('spawn docker ENOENT')))
    assert.equal(check.outcome, 'failed')
    assert.match(check.findings[0].message, /Docker could not start/)
  })
})

describe('the catalog validator', () => {
  const target = { ref: 'abc123', repository: 'owner/example', token: 'secret' }
  const validate = (runner: ScriptedRunner, project = integration) =>
    new CatalogValidator(runner, target, new RecordingReporter()).validate(project)

  it('runs the pinned image against the commit, with the token in the environment', async () => {
    const runner = answered(0, '::INFO:: <Validation brands> completed\n::INFO:: <Validation topics> completed\n')
    const check = await validate(runner, dashboard)
    assert.equal(check.summary, '2 checks passed')
    const [{ argumentList, options }] = runner.commands
    assert.ok(!argumentList.includes('secret'))
    assert.match(argumentList.at(-1)!, /^ghcr\.io\/hacs\/action:main@sha256:[0-9a-f]{64}$/)
    assert.deepEqual(options?.environment, {
      CATEGORY: 'plugin',
      INPUT_GITHUB_TOKEN: 'secret',
      INPUT_REPOSITORY: 'owner/example',
      REPOSITORY: 'owner/example',
      REPOSITORY_REF: 'abc123',
    })
  })

  it('turns failed checks and logged errors into findings', async () => {
    const check = await validate(answered(1, [
      '::INFO:: <Validation archived> completed',
      '::ERROR:: <Validation topics> failed:  The repository has no valid topics (More info: https://example.test/topics )',
      '::ERROR:: <Validation brands> failed:  Not in brands',
      '::ERROR:: <Theme owner/example> Repository structure is not compliant',
      '::ERROR:: <Integration owner/example> 2/3 checks failed',
    ].join('\n')))
    assert.equal(check.outcome, 'failed')
    assert.deepEqual(check.findings.map((finding) => finding.message), [
      'topics: The repository has no valid topics',
      'brands: Not in brands',
      'Repository structure is not compliant',
    ])
  })

  it('takes what it logs as warnings when every check passed', async () => {
    const check = await validate(answered(0, [
      '::ERROR:: \'NoneType\' object has no attribute \'items\'',
      'Traceback (most recent call last):',
      '::WARNING:: <Integration owner/example> The integration manifest has no categories',
      '::INFO:: <Validation brands> completed',
      '::INFO:: <Integration owner/example> All (1) checks passed',
    ].join('\n')))
    assert.equal(check.outcome, 'passed')
    assert.equal(check.summary, '1 check passed, with 2 warnings')
    assert.deepEqual(check.findings, [
      { message: '\'NoneType\' object has no attribute \'items\'', severity: 'warning' },
      { message: 'The integration manifest has no categories', severity: 'warning' },
    ])
  })

  it('fails with the end of the output when it reports only warnings', async () => {
    const check = await validate(answered(1, '::WARNING:: Slow\nKilled'))
    assert.equal(check.outcome, 'failed')
    assert.equal(check.findings[1].message, 'The catalog checks exited with 1: ::WARNING:: Slow\nKilled')
  })

  it('fails with the end of the output when it reports nothing', async () => {
    const check = await validate(answered(1, 'Killed'))
    assert.equal(check.findings[0].message, 'The catalog checks exited with 1: Killed')
  })

  it('fails when Docker is unavailable', async () => {
    const check = await validate(answered(1, 'exec format error'))
    assert.match(check.findings[0].message, /cannot run linux\/amd64 images/)
  })

  it('counts one check', async () => {
    assert.equal((await validate(answered(0, '<Validation issues> completed'))).summary, '1 check passed')
  })
})

describe('the GitHub project source', () => {
  it('lists and reads the blobs of the tree at a ref', async () => {
    const requests: RecordedRequest[] = []
    const source = new GitHubProjectSource(octokitOn({ files: { 'a/b.txt': 'hello', 'hacs.json': '{}' } }, requests), 'owner/example', 'v1.0.0')
    assert.deepEqual(await source.files(), [{ path: 'a/b.txt', size: 5 }, { path: 'hacs.json', size: 2 }])
    assert.equal(Buffer.from((await source.read('a/b.txt'))!).toString(), 'hello')
    assert.equal(await source.read('missing'), undefined)
    assert.deepEqual(requests.map((request) => request.path), ['commits/v1.0.0', 'git/trees/root-tree', 'git/blobs/blob-0'])
  })

  it('refuses a tree too large to read', async () => {
    const source = new GitHubProjectSource(octokitOn({ truncated: true }), 'owner/example', 'v1')
    await assert.rejects(source.files(), /too large/)
  })
})

describe('the GitHub repository directory', () => {
  it('describes the repository once', async () => {
    const requests: RecordedRequest[] = []
    const directory = new GitHubRepositoryDirectory(octokitOn({ name: 'example', private: true }, requests), 'owner/example')
    assert.deepEqual(await directory.describe(), { name: 'example', private: true })
    await directory.describe()
    assert.equal(requests.length, 1)
  })
})

describe('the GitHub release asset uploader', () => {
  const asset = { content: Buffer.from('zip'), contentType: 'application/zip', name: 'example.zip' }

  it('replaces an asset of the same name', async () => {
    const requests: RecordedRequest[] = []
    const releases = [{ assets: [{ id: 7, name: 'example.zip' }, { id: 8, name: 'other.zip' }], id: 3, tag: 'v1.0.0' }]
    const uploader = new GitHubReleaseAssetUploader(octokitOn({ releases }, requests), 'owner/example')
    assert.equal(await uploader.upload('v1.0.0', asset), 'https://github.com/owner/example/releases/download/tag/example.zip')
    assert.deepEqual(requests.map(({ host, method, path }) => `${method} ${host} ${path}`), [
      'GET api.github.com releases/tags/v1.0.0',
      'GET api.github.com releases/3/assets',
      'DELETE api.github.com releases/assets/7',
      'POST uploads.github.com releases/3/assets',
    ])
    assert.match(requests[3].search, /^\?name=example\.zip/)
    assert.equal(Buffer.from(requests[3].body!).toString(), 'zip')
  })

  it('uploads next to no previous asset', async () => {
    const requests: RecordedRequest[] = []
    const uploader = new GitHubReleaseAssetUploader(octokitOn({ releases: [{ id: 3, tag: 'v1' }] }, requests), 'owner/example')
    await uploader.upload('v1', asset)
    assert.ok(!requests.some((request) => request.method === 'DELETE'))
  })

  it('refuses a tag without a published release', async () => {
    const uploader = new GitHubReleaseAssetUploader(octokitOn({}), 'owner/example')
    await assert.rejects(uploader.upload('v9', asset), (error) => error instanceof ReleaseAssetError && /v9 has no published release/.test(error.message))
  })

  it('lets other API errors through', async () => {
    const failing = new Octokit({ request: { fetch: async () => new Response('{"message":"boom"}', { status: 500 }) }, retry: { enabled: false } })
    const uploader = new GitHubReleaseAssetUploader(failing, 'owner/example')
    await assert.rejects(uploader.upload('v1', asset), /boom/)
  })
})

describe('the zip archiver', () => {
  it('writes the entries in order', () => {
    const archive = new ZipArchiver().archive([
      { content: Buffer.from('second'), path: 'b/second.txt' },
      { content: Buffer.from('first'), path: 'a.txt' },
    ])
    const entries = unzipSync(archive)
    assert.deepEqual(Object.keys(entries), ['a.txt', 'b/second.txt'])
    assert.equal(Buffer.from(entries['b/second.txt']).toString(), 'second')
  })

  it('writes the same bytes for the same entries', () => {
    const entries = [{ content: Buffer.from('same'), path: 'a.txt' }]
    assert.deepEqual(new ZipArchiver().archive(entries), new ZipArchiver().archive(entries))
  })
})
