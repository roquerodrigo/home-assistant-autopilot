import type { HomeAssistantProject } from '../domain/home-assistant-project.ts'
import type { ArchiveAsset } from '../domain/release-asset.ts'
import type { ArchiveEntry, Archiver, ProjectSource, ReleaseAssetUploader, Reporter, RepositoryDirectory } from './ports.ts'

import { ReleaseAssetError } from '../domain/errors.ts'
import { MARKETPLACE_MANIFEST_PATH } from '../domain/marketplace-manifest.ts'
import { releaseVersionConflicts } from '../domain/project-checks.ts'
import { contentTypeOf, DOWNLOAD_LIMIT, exceededLimit } from '../domain/release-asset.ts'
import { versionOfTag } from '../domain/version-declarations.ts'
import { readProjectSnapshot } from './project-snapshot.ts'

export interface PublishedAsset {
  name: string
  url: string
}

export interface PublishOutcome {
  asset: PublishedAsset | undefined
  domain: string | undefined
  project: HomeAssistantProject
}

export interface PublishReleaseAssetDependencies {
  archiver: Archiver
  directory: RepositoryDirectory
  reporter: Reporter
  sourceAt: (tag: string) => ProjectSource
  uploader: ReleaseAssetUploader
}

export class PublishReleaseAsset {
  private readonly dependencies: PublishReleaseAssetDependencies

  constructor(dependencies: PublishReleaseAssetDependencies) {
    this.dependencies = dependencies
  }

  async run(tag: string): Promise<PublishOutcome> {
    const { directory, reporter, sourceAt, uploader } = this.dependencies
    const repository = await directory.describe()
    const source = sourceAt(tag)
    const { integrationManifest, project, versions } = await readProjectSnapshot(source, repository.name)
    const domain = integrationManifest?.domain ?? project.directoryDomain
    if (project.category === 'integration' && !integrationManifest?.version) {
      throw new ReleaseAssetError(`${project.integrationManifestPath} declares no version at ${tag}, and the Home Assistant Marketplace refuses to install it`)
    }
    const version = versionOfTag(tag)
    const conflicts = releaseVersionConflicts(versions, version)
    if (conflicts.length > 0) {
      const declared = conflicts.map((conflict) => `${conflict.path} declares ${conflict.version}`).join(', ')
      throw new ReleaseAssetError(`${tag} releases ${version}, but ${declared}`)
    }
    const asset = project.releaseAsset
    if (!asset) {
      reporter.info(nothingToAttach(project, tag))
      return { asset: undefined, domain, project }
    }
    const content = asset.kind === 'archive' ?
        this.dependencies.archiver.archive(await archiveEntries(source, asset)) :
        await readFile(source, asset.path)
    const url = await uploader.upload(tag, { content, contentType: contentTypeOf(asset), name: asset.name })
    reporter.info(`Attached ${asset.name} to ${tag}`)
    return { asset: { name: asset.name, url }, domain, project }
  }
}

async function archiveEntries(source: ProjectSource, asset: ArchiveAsset): Promise<ArchiveEntry[]> {
  const exceeded = exceededLimit(asset.files, DOWNLOAD_LIMIT)
  if (exceeded) {
    throw new ReleaseAssetError(`${asset.name} would hold ${exceeded}`)
  }
  const prefix = asset.root === '' ? '' : `${asset.root}/`
  return Promise.all(asset.files.map(async (file) => ({
    content: await readFile(source, file.path),
    path: file.path.slice(prefix.length),
  })))
}

function nothingToAttach(project: HomeAssistantProject, tag: string): string {
  if (project.category !== 'integration') {
    return `The Home Assistant Marketplace installs a ${project.category} from the repository, so ${tag} needs no asset`
  }
  if (project.manifest.zipRelease) {
    throw new ReleaseAssetError(`zip_release in ${MARKETPLACE_MANIFEST_PATH} needs filename to name the zip, ending in .zip`)
  }
  return `${MARKETPLACE_MANIFEST_PATH} does not declare zip_release, so the Home Assistant Marketplace installs ${tag} from the repository and it needs no asset`
}

async function readFile(source: ProjectSource, path: string): Promise<Uint8Array> {
  const content = await source.read(path)
  if (!content) {
    throw new ReleaseAssetError(`${path} could not be read`)
  }
  return content
}
