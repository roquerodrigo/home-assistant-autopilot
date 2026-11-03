import type { HomeAssistantProject } from '../domain/home-assistant-project.ts'
import type { ProjectFile } from '../domain/project-file.ts'
import type { ValidationCheck } from '../domain/validation-report.ts'

export interface ArchiveEntry {
  content: Uint8Array
  path: string
}

export interface Archiver {
  archive(entries: readonly ArchiveEntry[]): Uint8Array
}

export interface ExternalValidator {
  validate(project: HomeAssistantProject): Promise<ValidationCheck>
}

export interface ProjectSource {
  files(): Promise<ProjectFile[]>
  read(path: string): Promise<Uint8Array | undefined>
}

export interface ReleaseAssetUpload {
  content: Uint8Array
  contentType: string
  name: string
}

export interface ReleaseAssetUploader {
  upload(tag: string, asset: ReleaseAssetUpload): Promise<string>
}

export interface Reporter {
  group(title: string, lines: readonly string[]): void
  info(message: string): void
  warning(message: string): void
}

export interface RepositoryDescription {
  name: string
  private: boolean
}

export interface RepositoryDirectory {
  describe(): Promise<RepositoryDescription>
}
