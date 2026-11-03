import type { Octokit } from '@octokit/rest'

import type { ProjectSource } from '../application/ports.ts'
import type { ProjectFile } from '../domain/project-file.ts'

interface TreeEntry {
  sha: string
  size: number
}

export class GitHubProjectSource implements ProjectSource {
  private entries: Promise<Map<string, TreeEntry>> | undefined
  private readonly octokit: Octokit
  private readonly owner: string
  private readonly ref: string
  private readonly repo: string

  constructor(octokit: Octokit, repository: string, ref: string) {
    this.octokit = octokit
    this.ref = ref
    const [owner, repo] = repository.split('/')
    this.owner = owner
    this.repo = repo
  }

  async files(): Promise<ProjectFile[]> {
    return [...(await this.tree()).entries()].map(([path, { size }]) => ({ path, size }))
  }

  async read(path: string): Promise<Uint8Array | undefined> {
    const entry = (await this.tree()).get(path)
    if (!entry) {
      return undefined
    }
    const { data } = await this.octokit.git.getBlob({ file_sha: entry.sha, owner: this.owner, repo: this.repo })
    return Buffer.from(data.content, 'base64')
  }

  private async readTree(): Promise<Map<string, TreeEntry>> {
    const { data: commit } = await this.octokit.repos.getCommit({ owner: this.owner, ref: this.ref, repo: this.repo })
    const { data: tree } = await this.octokit.git.getTree({
      owner: this.owner,
      recursive: 'true',
      repo: this.repo,
      tree_sha: commit.commit.tree.sha,
    })
    if (tree.truncated) {
      throw new Error(`the tree of ${this.ref} is too large to read through the GitHub API`)
    }
    return new Map(tree.tree
      .filter((entry) => entry.type === 'blob' && entry.path && entry.sha)
      .map((entry) => [entry.path!, { sha: entry.sha!, size: entry.size ?? 0 }]))
  }

  private tree(): Promise<Map<string, TreeEntry>> {
    this.entries ??= this.readTree()
    return this.entries
  }
}
