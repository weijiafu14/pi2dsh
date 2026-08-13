export type CompatibilityLevel = 'full' | 'partial' | 'unsupported'

export interface CompatibilityFinding {
  capability: string
  level: CompatibilityLevel
  file: string
  line: number
  detail: string
}

export interface ResourceInventory {
  extensions: string[]
  skills: string[]
  prompts: string[]
  themes: string[]
}

export interface PackageIdentity {
  name: string
  version: string
  source: string
}

export interface CompatibilityReport {
  schemaVersion: 1
  package: PackageIdentity
  verdict: 'ready' | 'review' | 'blocked'
  summary: Record<CompatibilityLevel, number>
  resources: ResourceInventory
  findings: CompatibilityFinding[]
}

export interface ResolvedPiPackage {
  rootDir: string
  temporary: boolean
  identity: PackageIdentity
  packageJson: Record<string, unknown>
  resources: ResourceInventory
  dispose(): Promise<void>
}

export interface GeneratedRuntimeManifest {
  schemaVersion: 1
  package: PackageIdentity
  extensions: string[]
  skillDirs: string[]
  prompts: Array<{
    name: string
    description: string
    argumentHint?: string
    path: string
  }>
  report: CompatibilityReport
}

export interface GenerateOptions {
  outDir: string
  runtimeSpec?: string
  strict?: boolean
  allowUnsupported?: boolean
}
