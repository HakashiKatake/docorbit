import type {
  Ecosystem,
  ProjectDependency,
} from '../../../shared/src/index.ts';

export interface EcosystemStrategy {
  readonly ecosystem: Ecosystem;
  readonly manifestNames: string[];
  readonly lockfileNames?: string[];

  parseManifest(fileName: string, content: string, relPath: string, packageDir: string): ProjectDependency[];
  parseLockfile?(fileName: string, content: string): Map<string, string>;
  resolveVersions?(
    deps: ProjectDependency[],
    pkgDir: string,
    lockfileCache: Map<string, Map<string, string>>
  ): void;
}
