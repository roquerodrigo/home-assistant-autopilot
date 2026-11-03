import { type Zippable, zipSync } from 'fflate'

import type { ArchiveEntry, Archiver } from '../application/ports.ts'

const REPRODUCIBLE_TIMESTAMP = new Date(1980, 0, 1)

export class ZipArchiver implements Archiver {
  archive(entries: readonly ArchiveEntry[]): Uint8Array {
    const zippable: Zippable = {}
    for (const entry of [...entries].sort((first, second) => first.path.localeCompare(second.path))) {
      zippable[entry.path] = [entry.content, { mtime: REPRODUCIBLE_TIMESTAMP }]
    }
    return zipSync(zippable, { level: 9 })
  }
}
