export interface ProjectFile {
  path: string
  size: number
}

export function directoryOf(path: string): string {
  const separator = path.lastIndexOf('/')
  return separator === -1 ? '' : path.slice(0, separator)
}

export function filesUnder(files: readonly ProjectFile[], directory: string): ProjectFile[] {
  return files.filter((file) => file.path.startsWith(`${directory}/`))
}

export function nameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}
