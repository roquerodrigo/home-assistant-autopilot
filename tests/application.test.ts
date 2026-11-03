import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { ArchiveEntry, Archiver, ReleaseAssetUpload, ReleaseAssetUploader } from '../src/application/ports.ts'

import { PublishReleaseAsset } from '../src/application/publish-release-asset.ts'
import { ValidateProject } from '../src/application/validate-project.ts'
import { ReleaseAssetError } from '../src/domain/errors.ts'
import {
  DASHBOARD,
  type FileTree,
  FixedDirectory,
  INTEGRATION,
  MemoryProjectSource,
  PassingValidator,
  RecordingReporter,
  withFiles,
} from './support.ts'

class RecordingArchiver implements Archiver {
  entries: readonly ArchiveEntry[] = []

  archive(entries: readonly ArchiveEntry[]): Uint8Array {
    this.entries = entries
    return Buffer.from('zip')
  }
}

class RecordingUploader implements ReleaseAssetUploader {
  uploads: { asset: ReleaseAssetUpload, tag: string }[] = []

  async upload(tag: string, asset: ReleaseAssetUpload): Promise<string> {
    this.uploads.push({ asset, tag })
    return `https://example.test/${asset.name}`
  }
}

describe('validating a project', () => {
  const validate = (tree: FileTree, repositoryPrivate = false) => {
    const hassfest = new PassingValidator('Hassfest')
    const catalog = new PassingValidator('Catalog')
    const run = new ValidateProject({
      catalog,
      directory: new FixedDirectory({ private: repositoryPrivate }),
      hassfest,
      source: new MemoryProjectSource(tree),
    }).run()
    return { catalog, hassfest, run }
  }

  it('runs every check on an integration', async () => {
    const { catalog, hassfest, run } = validate(INTEGRATION)
    const { domain, project, report } = await run
    assert.equal(domain, 'example')
    assert.equal(project?.category, 'integration')
    assert.deepEqual(report.checks.map((check) => [check.name, check.outcome]), [
      ['Layout', 'passed'],
      ['hacs.json', 'passed'],
      ['Versions', 'passed'],
      ['Download size', 'passed'],
      ['Hassfest', 'passed'],
      ['Catalog', 'passed'],
    ])
    assert.equal(hassfest.validated.length, 1)
    assert.equal(catalog.validated.length, 1)
  })

  it('catches a version that drifted', async () => {
    const { report } = await validate(withFiles(INTEGRATION, { 'pyproject.toml': '[project]\nversion = "1.1.0"\n' })).run
    assert.equal(report.checks.find((check) => check.name === 'Versions')?.outcome, 'failed')
  })

  it('skips hassfest for what is not an integration', async () => {
    const { hassfest, run } = validate(DASHBOARD)
    const { domain, report } = await run
    assert.equal(domain, undefined)
    assert.equal(report.checks.find((check) => check.name === 'Hassfest')?.outcome, 'skipped')
    assert.equal(hassfest.validated.length, 0)
  })

  it('skips the catalog checks for a private repository and says why', async () => {
    const { catalog, run } = validate(INTEGRATION, true)
    const check = (await run).report.checks.find((candidate) => candidate.name === 'Catalog')
    assert.equal(check?.outcome, 'skipped')
    assert.equal(check?.summary, 'A private repository cannot enter the Home Assistant Marketplace')
    assert.equal(catalog.validated.length, 0)
  })

  it('reads the domain of an integration at the root from its manifest', async () => {
    const tree = {
      'hacs.json': '{"name":"Root","content_in_root":true}',
      'manifest.json': '{"domain":"root","version":"1.0.0"}',
    }
    assert.equal((await validate(tree).run).domain, 'root')
  })

  it('reports a layout it cannot read instead of failing', async () => {
    const { project, report } = await validate({ 'README.md': '' }).run
    assert.equal(project, undefined)
    assert.equal(report.failed, true)
    assert.equal(report.checks[0].findings[0].message, 'There is no hacs.json at the root, which every Home Assistant Marketplace repository needs')
    assert.deepEqual(report.checks.slice(1).map((check) => check.outcome), ['skipped', 'skipped', 'skipped', 'skipped', 'skipped'])
  })

  it('lets an unexpected error through', async () => {
    const source = new MemoryProjectSource(INTEGRATION)
    source.files = async () => {
      throw new Error('disk failure')
    }
    const run = new ValidateProject({
      catalog: new PassingValidator('Catalog'),
      directory: new FixedDirectory(),
      hassfest: new PassingValidator('Hassfest'),
      source,
    }).run()
    await assert.rejects(run, /disk failure/)
  })
})

describe('publishing the release asset', () => {
  const publish = (tree: FileTree, tag = 'v1.2.0') => {
    const archiver = new RecordingArchiver()
    const reporter = new RecordingReporter()
    const uploader = new RecordingUploader()
    const refs: string[] = []
    const run = new PublishReleaseAsset({
      archiver,
      directory: new FixedDirectory(),
      reporter,
      sourceAt: (ref) => {
        refs.push(ref)
        return new MemoryProjectSource(tree)
      },
      uploader,
    }).run(tag)
    return { archiver, refs, reporter, run, uploader }
  }

  it('zips the integration directory at the root of the archive', async () => {
    const { archiver, refs, reporter, run, uploader } = publish(INTEGRATION)
    const { asset, domain, project } = await run
    assert.deepEqual(refs, ['v1.2.0'])
    assert.equal(domain, 'example')
    assert.equal(project.category, 'integration')
    assert.deepEqual(archiver.entries.map((entry) => entry.path), ['__init__.py', 'manifest.json', 'translations/en.json'])
    assert.deepEqual(asset, { name: 'example.zip', url: 'https://example.test/example.zip' })
    assert.equal(uploader.uploads[0].tag, 'v1.2.0')
    assert.equal(uploader.uploads[0].asset.contentType, 'application/zip')
    assert.deepEqual(reporter.messages, ['Attached example.zip to v1.2.0'])
  })

  it('zips an integration at the root without a prefix to strip', async () => {
    const { archiver, run } = publish({
      'hacs.json': '{"name":"Root","content_in_root":true,"zip_release":true,"filename":"root.zip"}',
      'manifest.json': '{"domain":"root","version":"1.0.0"}',
    }, '1.0.0')
    await run
    assert.deepEqual(archiver.entries.map((entry) => entry.path), ['manifest.json'])
  })

  it('attaches the dashboard module as it is', async () => {
    const { run, uploader } = publish(DASHBOARD)
    const { asset, domain } = await run
    assert.equal(asset?.name, 'example-card.js')
    assert.equal(domain, undefined)
    assert.equal(Buffer.from(uploader.uploads[0].asset.content).toString(), DASHBOARD['example-card.js'])
    assert.equal(uploader.uploads[0].asset.contentType, 'text/javascript')
  })

  it('refuses a tag the manifest disagrees with', async () => {
    const { run, uploader } = publish(INTEGRATION, 'v1.3.0')
    await assert.rejects(run, (error) => error instanceof ReleaseAssetError &&
      error.message === 'v1.3.0 releases 1.3.0, but custom_components/example/manifest.json declares 1.2.0, pyproject.toml declares 1.2.0')
    assert.equal(uploader.uploads.length, 0)
  })

  it('refuses an integration without a version', async () => {
    const tree = withFiles(INTEGRATION, { 'custom_components/example/manifest.json': '{"domain":"example"}', 'pyproject.toml': undefined })
    await assert.rejects(publish(tree).run, /declares no version at v1.2.0/)
  })

  it('attaches nothing when the Home Assistant Marketplace installs from the repository', async () => {
    const { reporter, run, uploader } = publish(withFiles(INTEGRATION, { 'hacs.json': '{"name":"Example"}' }))
    assert.equal((await run).asset, undefined)
    assert.equal(uploader.uploads.length, 0)
    assert.match(reporter.messages[0], /does not declare zip_release/)
    const theme = publish({ 'hacs.json': '{"name":"T"}', 'themes/dark.yaml': '' }, 'v1')
    await theme.run
    assert.equal(theme.reporter.messages[0], 'The Home Assistant Marketplace installs a theme from the repository, so v1 needs no asset')
  })

  it('refuses zip_release without a zip to name', async () => {
    await assert.rejects(publish(withFiles(INTEGRATION, { 'hacs.json': '{"name":"E","zip_release":true}' })).run, /needs filename to name the zip/)
  })

  it('refuses an archive over the download limit', async () => {
    const tree = { ...INTEGRATION }
    for (let index = 0; index < 50_001; index += 1) {
      tree[`custom_components/example/data/${index}`] = ''
    }
    await assert.rejects(publish(tree).run, /example.zip would hold 50004 files, over the limit of 50000/)
  })

  it('refuses a file it cannot read', async () => {
    const archiver = new RecordingArchiver()
    const source = new MemoryProjectSource(DASHBOARD)
    const read = source.read.bind(source)
    source.read = async (path) => path === 'example-card.js' ? undefined : read(path)
    const run = new PublishReleaseAsset({
      archiver,
      directory: new FixedDirectory(),
      reporter: new RecordingReporter(),
      sourceAt: () => source,
      uploader: new RecordingUploader(),
    }).run('v1')
    await assert.rejects(run, /example-card.js could not be read/)
  })
})
