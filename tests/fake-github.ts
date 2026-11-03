export interface FakeRelease {
  assets?: { id: number, name: string }[]
  id: number
  tag: string
}

export interface FakeRepository {
  files?: Record<string, string>
  name?: string
  private?: boolean
  releases?: FakeRelease[]
  truncated?: boolean
}

export interface RecordedRequest {
  body: Uint8Array | undefined
  host: string
  method: string
  path: string
  search: string
}

const NOT_FOUND = { data: { message: 'Not Found' }, status: 404 }

export function fakeGitHub(repository: FakeRepository, requests: RecordedRequest[] = []): typeof fetch {
  return async (input, init) => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    const path = url.pathname.split('/').slice(4).join('/')
    requests.push({
      body: init?.body instanceof Uint8Array ? init.body : undefined,
      host: url.hostname,
      method,
      path,
      search: url.search,
    })
    const { data, status = 200 } = answer(repository, method, path, url)
    return new Response(status === 204 ? null : JSON.stringify(data), {
      headers: { 'content-type': 'application/json' },
      status,
    })
  }
}

function answer(repository: FakeRepository, method: string, path: string, url: URL): { data?: unknown, status?: number } {
  const files = repository.files ?? {}
  const paths = Object.keys(files)
  if (method === 'GET' && path === '') {
    return { data: { name: repository.name ?? 'example', private: repository.private ?? false } }
  }
  if (method === 'GET' && path.startsWith('commits/')) {
    return { data: { commit: { tree: { sha: 'root-tree' } } } }
  }
  if (method === 'GET' && path === 'git/trees/root-tree') {
    return {
      data: {
        tree: [
          { path: 'custom_components', sha: 'directory', type: 'tree' },
          ...paths.map((file, index) => ({ path: file, sha: `blob-${index}`, size: Buffer.byteLength(files[file]), type: 'blob' })),
        ],
        truncated: repository.truncated ?? false,
      },
    }
  }
  if (method === 'GET' && path.startsWith('git/blobs/blob-')) {
    const file = paths[Number(path.slice('git/blobs/blob-'.length))]
    return { data: { content: Buffer.from(files[file]).toString('base64'), encoding: 'base64' } }
  }
  const release = repository.releases?.find((candidate) => path === `releases/tags/${candidate.tag}`)
  if (method === 'GET' && path.startsWith('releases/tags/')) {
    return release ? { data: { id: release.id, tag_name: release.tag } } : NOT_FOUND
  }
  const listed = repository.releases?.find((candidate) => path === `releases/${candidate.id}/assets`)
  if (method === 'GET' && listed) {
    return { data: listed.assets ?? [] }
  }
  if (method === 'DELETE' && path.startsWith('releases/assets/')) {
    return { status: 204 }
  }
  if (method === 'POST' && url.hostname === 'uploads.github.com') {
    const name = url.searchParams.get('name')
    return { data: { browser_download_url: `https://github.com/owner/example/releases/download/tag/${name}`, name }, status: 201 }
  }
  return NOT_FOUND
}
