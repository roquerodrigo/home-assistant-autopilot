import type { Octokit } from '@octokit/rest'

import type { RepositoryDescription, RepositoryDirectory } from '../application/ports.ts'

export class GitHubRepositoryDirectory implements RepositoryDirectory {
  private description: Promise<RepositoryDescription> | undefined
  private readonly octokit: Octokit
  private readonly repository: string

  constructor(octokit: Octokit, repository: string) {
    this.octokit = octokit
    this.repository = repository
  }

  describe(): Promise<RepositoryDescription> {
    const [owner, repo] = this.repository.split('/')
    this.description ??= this.octokit.repos.get({ owner, repo }).then(({ data }) => ({ name: data.name, private: data.private }))
    return this.description
  }
}
