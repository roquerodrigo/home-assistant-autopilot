import type { ProjectFile } from './project-file.ts'

export interface ArchiveAsset {
  files: readonly ProjectFile[]
  kind: 'archive'
  name: string
  root: string
}

export interface DownloadLimit {
  bytes: number
  files: number
}

export interface FileAsset {
  kind: 'file'
  name: string
  path: string
}

export type ReleaseAsset = ArchiveAsset | FileAsset

const MEBIBYTE = 1024 * 1024

export const DOWNLOAD_LIMIT: DownloadLimit = { bytes: 100 * MEBIBYTE, files: 50_000 }

export const TEMPLATE_LIMIT: DownloadLimit = { bytes: 5 * MEBIBYTE, files: 1 }

export function contentTypeOf(asset: ReleaseAsset): string {
  if (asset.kind === 'archive') {
    return 'application/zip'
  }
  return asset.name.endsWith('.js') ? 'text/javascript' : 'application/octet-stream'
}

export function exceededLimit(files: readonly ProjectFile[], limit: DownloadLimit): string | undefined {
  const bytes = files.reduce((total, file) => total + file.size, 0)
  if (files.length > limit.files) {
    return `${files.length} files, over the limit of ${limit.files}`
  }
  if (bytes > limit.bytes) {
    return `${formatMebibytes(bytes)}, over the limit of ${formatMebibytes(limit.bytes)}`
  }
  return undefined
}

function formatMebibytes(bytes: number): string {
  return `${(bytes / MEBIBYTE).toFixed(1)} MiB`
}
