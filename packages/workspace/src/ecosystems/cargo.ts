import { join } from 'node:path';
import type { ProjectDependency } from '../../../shared/src/index.ts';
import type { EcosystemStrategy } from './types.ts';

export class CargoStrategy implements EcosystemStrategy {
  readonly ecosystem = 'cargo';
  readonly manifestNames = ['cargo.toml'];
  readonly lockfileNames = ['cargo.lock'];

  parseManifest(_fileName: string, content: string, relPath: string, packageDir: string): ProjectDependency[] {
    const deps: ProjectDependency[] = [];
    let currentSection = '';
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        currentSection = trimmed.slice(1, -1).trim();
        continue;
      }

      const isDep =
        currentSection === 'dependencies' ||
        currentSection === 'dev-dependencies' ||
        currentSection === 'build-dependencies';

      if (isDep && trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
        const eqIdx = trimmed.indexOf('=');
        const name = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();

        let version = '*';
        if (val.startsWith('"')) {
          version = val.replace(/^"|"$/g, '');
        } else if (val.startsWith('{')) {
          const vMatch = val.match(/version\s*=\s*"([^"]+)"/);
          if (vMatch) version = vMatch[1];
        }

        deps.push({
          name,
          ecosystem: 'cargo',
          requestedVersion: version,
          sourceFile: relPath,
          packagePath: packageDir,
          isDev: currentSection === 'dev-dependencies',
        });
      }
    }
    return deps;
  }

  parseLockfile(_fileName: string, content: string): Map<string, string> {
    const resolved = new Map<string, string>();
    const blocks = content.split('[[package]]');
    for (const block of blocks) {
      const nameMatch = block.match(/name\s*=\s*"([^"]+)"/);
      const verMatch = block.match(/version\s*=\s*"([^"]+)"/);
      if (nameMatch && verMatch) {
        resolved.set(nameMatch[1], verMatch[1]);
      }
    }
    return resolved;
  }

  resolveVersions(
    deps: ProjectDependency[],
    pkgDir: string,
    lockfileCache: Map<string, Map<string, string>>
  ): void {
    const lockMap =
      lockfileCache.get('Cargo.lock') ||
      lockfileCache.get('cargo.lock') ||
      lockfileCache.get(join(pkgDir, 'Cargo.lock')) ||
      lockfileCache.get(join(pkgDir, 'cargo.lock'));

    if (lockMap) {
      for (const dep of deps) {
        const resolved = lockMap.get(dep.name);
        if (resolved) dep.resolvedVersion = resolved;
      }
    }
  }
}
