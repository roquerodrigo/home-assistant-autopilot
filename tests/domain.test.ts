import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { InvalidProjectError } from '../src/domain/errors.ts'
import { detectProject, type HomeAssistantProject } from '../src/domain/home-assistant-project.ts'
import { parseIntegrationManifest } from '../src/domain/integration-manifest.ts'
import { type MarketplaceManifest, parseMarketplaceManifest } from '../src/domain/marketplace-manifest.ts'
import {
  describeProject,
  downloadSizeCheck,
  layoutCheck,
  marketplaceManifestCheck,
  releaseVersionConflicts,
  versionsCheck,
} from '../src/domain/project-checks.ts'
import { directoryOf, nameOf } from '../src/domain/project-file.ts'
import { contentTypeOf, exceededLimit } from '../src/domain/release-asset.ts'
import { concludedCheck, skippedCheck, ValidationReport } from '../src/domain/validation-report.ts'
import { versionDeclarationsOf, versionOfTag } from '../src/domain/version-declarations.ts'
import { DASHBOARD, filesOf, type FileTree, INTEGRATION, withFiles } from './support.ts'

const detect = (tree: FileTree, repositoryName = 'example'): HomeAssistantProject =>
  detectProject(filesOf(tree), parseMarketplaceManifest(tree['hacs.json']), repositoryName)

const manifest = (declared: Record<string, unknown>): MarketplaceManifest => parseMarketplaceManifest(JSON.stringify(declared))

describe('the marketplace manifest', () => {
  it('reads the keys it knows', () => {
    assert.deepEqual(manifest({ content_in_root: true, filename: 'a.zip', name: 'A', zip_release: true }), {
      contentInRoot: true,
      filename: 'a.zip',
      name: 'A',
      obsoleteKeys: [],
      zipRelease: true,
    })
  })

  it('names the keys the Home Assistant Marketplace no longer reads', () => {
    assert.deepEqual(manifest({ hacs: '2.0.5', name: 'A', render_readme: true }).obsoleteKeys.map(({ key }) => key), ['hacs', 'render_readme'])
  })

  it('refuses what is not a JSON object', () => {
    assert.throws(() => parseMarketplaceManifest('{'), InvalidProjectError)
    assert.throws(() => parseMarketplaceManifest('[]'), /must hold a JSON object/)
    assert.throws(() => parseMarketplaceManifest('null'), /must hold a JSON object/)
  })

  it('refuses a key of the wrong type', () => {
    assert.throws(() => manifest({ zip_release: 'yes' }), /zip_release in hacs.json must be true or false/)
    assert.throws(() => manifest({ filename: '' }), /filename in hacs.json must be a non-empty string/)
    assert.throws(() => manifest({ name: 1 }), /name in hacs.json must be a non-empty string/)
  })
})

describe('the integration manifest', () => {
  it('reads the domain and the version', () => {
    assert.deepEqual(parseIntegrationManifest('{"domain":"a","version":"1.0.0"}', 'm.json'), { domain: 'a', version: '1.0.0' })
  })

  it('ignores values that are not text', () => {
    assert.deepEqual(parseIntegrationManifest('{"domain":1}', 'm.json'), { domain: undefined, version: undefined })
    assert.deepEqual(parseIntegrationManifest('null', 'm.json'), { domain: undefined, version: undefined })
  })

  it('refuses invalid JSON', () => {
    assert.throws(() => parseIntegrationManifest('{', 'm.json'), /m.json is not valid JSON/)
  })
})

describe('detecting the project', () => {
  it('finds an integration and the zip of its directory', () => {
    const project = detect(INTEGRATION)
    assert.equal(project.category, 'integration')
    assert.equal(project.directoryDomain, 'example')
    assert.equal(project.integrationManifestPath, 'custom_components/example/manifest.json')
    assert.deepEqual(project.installedFiles.map((file) => file.path), [
      'custom_components/example/__init__.py',
      'custom_components/example/manifest.json',
      'custom_components/example/translations/en.json',
    ])
    assert.equal(project.releaseAsset?.kind, 'archive')
    assert.equal(project.releaseAsset?.name, 'example.zip')
  })

  it('ships no zip without zip_release or a zip filename', () => {
    assert.equal(detect(withFiles(INTEGRATION, { 'hacs.json': '{"name":"Example"}' })).releaseAsset, undefined)
    assert.equal(detect(withFiles(INTEGRATION, { 'hacs.json': '{"name":"Example","zip_release":true,"filename":"x.tar"}' })).releaseAsset, undefined)
  })

  it('refuses more than one integration', () => {
    const tree = withFiles(INTEGRATION, { 'custom_components/other/manifest.json': '{}' })
    assert.throws(() => detect(tree), /more than one integration under custom_components: example, other/)
  })

  it('finds an integration at the root', () => {
    const project = detect({
      '.github/workflows/ci.yml': '',
      '__init__.py': '',
      'hacs.json': JSON.stringify({ content_in_root: true, filename: 'root.zip', name: 'Root', zip_release: true }),
      'manifest.json': '{"domain":"root","version":"1.0.0"}',
    })
    assert.equal(project.category, 'integration')
    assert.equal(project.directoryDomain, undefined)
    assert.equal(project.integrationManifestPath, 'manifest.json')
    assert.deepEqual(project.installedFiles.map((file) => file.path), ['__init__.py', 'manifest.json'])
    assert.equal(project.releaseAsset?.kind === 'archive' && project.releaseAsset.root, '')
  })

  it('finds a theme under themes or at the root', () => {
    assert.equal(detect({ 'hacs.json': '{"name":"T"}', 'themes/dark.yaml': 'dark: {}' }).category, 'theme')
    assert.equal(detect({ 'dark.yml': 'dark: {}', 'hacs.json': '{"name":"T","content_in_root":true}' }).installedFiles[0].path, 'dark.yml')
  })

  it('prefers the dashboard module named in hacs.json over a YAML file at the root', () => {
    const project = detect({ '.pre-commit-config.yaml': '', 'card.js': '', 'example.yaml': '', 'hacs.json': '{"name":"C","filename":"card.js","content_in_root":true}' })
    assert.equal(project.category, 'dashboard')
  })

  it('ignores hidden YAML files when looking for a theme', () => {
    assert.equal(detect({ '.yamllint.yaml': '', 'dark.yaml': '', 'hacs.json': '{"name":"T","content_in_root":true}' }).installedFiles[0].path, 'dark.yaml')
  })

  it('refuses more than one theme', () => {
    assert.throws(() => detect({ 'hacs.json': '{}', 'themes/a.yaml': '', 'themes/b.yaml': '' }), /a repository holds one theme, but there are 2/)
  })

  it('finds a template named in hacs.json', () => {
    const project = detect({ 'hacs.json': '{"name":"M","filename":"macros.jinja"}', 'macros.jinja': '{% macro a() %}{% endmacro %}' })
    assert.equal(project.category, 'template')
    assert.equal(project.releaseAsset, undefined)
  })

  it('refuses a template that is not at the root', () => {
    assert.throws(() => detect({ 'hacs.json': '{"filename":"macros.jinja"}', 'src/macros.jinja': '' }), /macros.jinja, named in hacs.json, is not at the root/)
  })

  it('finds a dashboard module named in hacs.json', () => {
    const project = detect(DASHBOARD)
    assert.equal(project.category, 'dashboard')
    assert.deepEqual(project.releaseAsset, { kind: 'file', name: 'example-card.js', path: 'example-card.js' })
    assert.deepEqual(project.installedFiles.map((file) => file.path), ['example-card.js'])
  })

  it('finds a dashboard module named after the repository, in dist with what it loads', () => {
    const project = detect({ 'dist/card.umd.js': '', 'dist/image.png': '', 'hacs.json': '{"name":"Card"}', 'src/card.ts': '' }, 'card')
    assert.equal(project.releaseAsset?.name, 'card.umd.js')
    assert.deepEqual(project.installedFiles.map((file) => file.path), ['dist/card.umd.js', 'dist/image.png'])
  })

  it('drops the lovelace- prefix of the repository name', () => {
    assert.equal(detect({ 'card.js': '', 'hacs.json': '{"name":"Card"}' }, 'lovelace-card').releaseAsset?.name, 'card.js')
  })

  it('refuses a dashboard module named in hacs.json that is missing', () => {
    assert.throws(() => detect({ 'hacs.json': '{"filename":"card.js"}' }), /card.js, named in hacs.json, is neither at the root nor in dist/)
  })

  it('refuses a repository it cannot tell', () => {
    assert.throws(() => detect({ 'hacs.json': '{"name":"Nothing"}', 'README.md': '' }), /cannot tell what this repository installs/)
  })
})

describe('the project checks', () => {
  const integrationManifest = { domain: 'example', version: '1.2.0' }

  it('describe what the project installs', () => {
    assert.equal(describeProject(detect(INTEGRATION), integrationManifest), 'Integration `example`')
    assert.equal(describeProject(detect(DASHBOARD)), 'Dashboard module `example-card.js`')
    assert.equal(describeProject({ ...detect(DASHBOARD), installedFiles: [], releaseAsset: undefined }), 'Dashboard module')
  })

  it('pass a sound integration layout', () => {
    assert.equal(layoutCheck(detect(INTEGRATION), integrationManifest).outcome, 'passed')
  })

  it('fail a manifest without domain or version', () => {
    const check = layoutCheck(detect(INTEGRATION), { domain: undefined, version: undefined })
    assert.deepEqual(check.findings.map((finding) => finding.message), [
      'The manifest declares no domain',
      'The manifest declares no version, and the Home Assistant Marketplace refuses to install it',
    ])
  })

  it('fail a domain in the wrong format or out of its directory', () => {
    assert.match(layoutCheck(detect(INTEGRATION), { domain: 'Bad-Domain', version: '1' }).findings[0].message, /lowercase letters/)
    assert.match(layoutCheck(detect(INTEGRATION), { domain: 'other', version: '1' }).findings[0].message, /differs from its directory/)
  })

  it('pass the layout of what is not an integration', () => {
    assert.equal(layoutCheck(detect(DASHBOARD), undefined).outcome, 'passed')
  })

  it('pass a consistent hacs.json and name the release asset', () => {
    const check = marketplaceManifestCheck(detect(INTEGRATION))
    assert.equal(check.outcome, 'passed')
    assert.equal(check.summary, 'Each release ships `example.zip`')
  })

  it('fail hacs.json without name or with zip_release where it does not apply', () => {
    const dashboard = detect({ ...DASHBOARD, 'hacs.json': '{"filename":"example-card.js","zip_release":true}' })
    assert.deepEqual(marketplaceManifestCheck(dashboard).findings.map((finding) => finding.message), [
      '`name` is required to enter the catalog',
      '`zip_release` only applies to integrations',
    ])
    const integration = detect(withFiles(INTEGRATION, { 'hacs.json': '{"name":"E","zip_release":true}' }))
    assert.match(marketplaceManifestCheck(integration).findings[0].message, /needs `filename`/)
  })

  it('warn about a filename nothing reads and about obsolete keys', () => {
    const project = detect(withFiles(INTEGRATION, { 'hacs.json': '{"name":"E","filename":"e.zip","hacs":"2.0.5"}' }))
    const check = marketplaceManifestCheck(project)
    assert.equal(check.outcome, 'passed')
    assert.equal(check.summary, 'Consistent, with 2 warnings')
    assert.deepEqual(check.findings.map((finding) => finding.severity), ['warning', 'warning'])
  })

  it('compare the declared versions', () => {
    const agreeing = [{ path: 'a', version: '1.0.0' }, { path: 'b', version: '1.0.0' }]
    assert.equal(versionsCheck(agreeing).summary, '1.0.0 in a, b')
    const check = versionsCheck([...agreeing, { path: 'c', version: '0.9.0' }])
    assert.equal(check.outcome, 'failed')
    assert.deepEqual(check.findings, [{ file: 'c', message: 'Declares 0.9.0, while a declares 1.0.0', severity: 'error' }])
    assert.equal(versionsCheck([]).outcome, 'skipped')
  })

  it('measure what the Home Assistant Marketplace downloads', () => {
    assert.equal(downloadSizeCheck(detect(DASHBOARD)).summary, '1 file, 0.1 KiB')
    const large = detect({ 'hacs.json': '{"filename":"m.jinja"}', 'm.jinja': 'x'.repeat(6 * 1024 * 1024) })
    assert.match(downloadSizeCheck(large).findings[0].message, /6.0 MiB, over the limit of 5.0 MiB/)
  })

  it('find the declarations that disagree with a release', () => {
    assert.deepEqual(releaseVersionConflicts([{ path: 'a', version: '1.0.0' }, { path: 'b', version: '2.0.0' }], '2.0.0'), [{ path: 'a', version: '1.0.0' }])
  })
})

describe('the versions', () => {
  it('come from the manifest, pyproject.toml and package.json', () => {
    assert.deepEqual(versionDeclarationsOf({
      integrationManifest: { manifest: { domain: 'a', version: '1.0.0' }, path: 'm.json' },
      packageJson: '{"version":"1.0.1"}',
      pyproject: '[project]\nversion = "1.0.2"\n',
    }), [
      { path: 'm.json', version: '1.0.0' },
      { path: 'pyproject.toml', version: '1.0.2' },
      { path: 'package.json', version: '1.0.1' },
    ])
  })

  it('skip a dynamic or missing version', () => {
    assert.deepEqual(versionDeclarationsOf({
      integrationManifest: { manifest: { domain: 'a', version: undefined }, path: 'm.json' },
      packageJson: '{"version":1}',
      pyproject: '[project]\nversion = "1.0.0"\ndynamic = ["version"]\n',
    }), [])
    assert.deepEqual(versionDeclarationsOf({ pyproject: '[tool.ruff]\n' }), [])
  })

  it('refuse files that do not parse', () => {
    assert.throws(() => versionDeclarationsOf({ packageJson: '{' }), /package.json is not valid JSON/)
    assert.throws(() => versionDeclarationsOf({ pyproject: '[' }), /pyproject.toml is not valid TOML/)
  })

  it('of a tag drop the v prefix', () => {
    assert.equal(versionOfTag('v1.2.3'), '1.2.3')
    assert.equal(versionOfTag('1.2.3'), '1.2.3')
    assert.equal(versionOfTag('version-1'), 'version-1')
  })
})

describe('the release asset', () => {
  it('has the content type of what it holds', () => {
    assert.equal(contentTypeOf({ files: [], kind: 'archive', name: 'a.zip', root: '' }), 'application/zip')
    assert.equal(contentTypeOf({ kind: 'file', name: 'a.js', path: 'a.js' }), 'text/javascript')
    assert.equal(contentTypeOf({ kind: 'file', name: 'a.mjs.map', path: 'a' }), 'application/octet-stream')
  })

  it('counts files against the limit', () => {
    assert.equal(exceededLimit([{ path: 'a', size: 1 }, { path: 'b', size: 1 }], { bytes: 10, files: 1 }), '2 files, over the limit of 1')
    assert.equal(exceededLimit([{ path: 'a', size: 1 }], { bytes: 10, files: 1 }), undefined)
  })
})

describe('the project files', () => {
  it('split a path', () => {
    assert.equal(directoryOf('a/b/c.js'), 'a/b')
    assert.equal(directoryOf('c.js'), '')
    assert.equal(nameOf('a/b/c.js'), 'c.js')
  })
})

describe('the validation report', () => {
  const report = new ValidationReport([
    concludedCheck('First', [{ file: 'a.json', message: 'Broken | badly', severity: 'error' }], 'Fine'),
    concludedCheck('Second', [{ message: 'Old', severity: 'warning' }], 'Fine'),
    skippedCheck('Third', 'Not here'),
  ])

  it('fails when a check fails', () => {
    assert.equal(report.failed, true)
    assert.equal(new ValidationReport([skippedCheck('Only', 'Nothing')]).failed, false)
  })

  it('renders a table with the findings', () => {
    const markdown = report.toMarkdown('Title')
    assert.match(markdown, /^## Title\n/)
    assert.match(markdown, /\| First \| ❌ Failed \| 1 problem \|/)
    assert.match(markdown, /\| Second \| ✅ Passed \| Fine, with 1 warning \|/)
    assert.match(markdown, /\| Third \| ⏭️ Skipped \| Not here \|/)
    assert.match(markdown, /- \*\*Error\*\*: `a.json`: Broken \| badly/)
    assert.match(markdown, /- Warning: Old/)
  })

  it('renders text for a terminal', () => {
    assert.equal(report.toText(), [
      '❌ Failed  First: 1 problem',
      '    error: a.json: Broken | badly',
      '✅ Passed  Second: Fine, with 1 warning',
      '    warning: Old',
      '⏭️ Skipped  Third: Not here',
      '',
    ].join('\n'))
  })
})
