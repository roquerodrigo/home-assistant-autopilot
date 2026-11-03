import type { Octokit } from '@octokit/rest'

import type { ReleaseAssetUpload, ReleaseAssetUploader } from '../application/ports.ts'

import { ReleaseAssetError } from '../domain/errors.ts'

export class GitHubReleaseAssetUploader implements ReleaseAssetUploader {
  private readonly octokit: Octokit
  private readonly owner: string
  private readonly repo: string

  constructor(octokit: Octokit, repository: string) {
    this.octokit = octokit
    const [owner, repo] = repository.split('/')
    this.owner = owner
    this.repo = repo
  }

  async upload(tag: string, asset: ReleaseAssetUpload): Promise<string> {
    const target = { owner: this.owner, repo: this.repo }
    const release = await this.octokit.repos.getReleaseByTag({ ...target, tag }).catch((error: unknown) => {
      if ((error as { status?: number }).status === 404) {
        throw new ReleaseAssetError(`${tag} has no published release, and the Home Assistant Marketplace only installs published releases`)
      }
      throw error
    })
    const assets = await this.octokit.paginate(this.octokit.repos.listReleaseAssets, { ...target, per_page: 100, release_id: release.data.id })
    const previous = assets.find((existing) => existing.name === asset.name)
    if (previous) {
      await this.octokit.repos.deleteReleaseAsset({ ...target, asset_id: previous.id })
    }
    const { data } = await this.octokit.repos.uploadReleaseAsset({
      ...target,
      data: asset.content as unknown as string,
      headers: { 'content-length': asset.content.byteLength, 'content-type': asset.contentType },
      name: asset.name,
      release_id: release.data.id,
    })
    return data.browser_download_url
  }
}
