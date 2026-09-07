import { join } from 'node:path';
import type { ProjectDependency } from '../../../shared/src/index.ts';
import type { EcosystemStrategy } from './types.ts';

export class NpmStrategy implements EcosystemStrategy {
  readonly ecosystem = 'npm';
  readonly manifestNames = ['package.json'];
  readonly lockfileNames = ['package-lock.json'];

  parseManifest(_fileName: string, content: string, relPath: string, packageDir: string): ProjectDependency[] {
    const deps: ProjectDependency[] = [];
    try {
      const pkg = JSON.parse(content);

      const addSection = (section: Record<string, string> | undefined, isDev: boolean) => {
        if (!section) return;
        for (const [name, version] of Object.entries(section)) {
          deps.push({
            name,
            ecosystem: 'npm',
            requestedVersion: String(version),
            sourceFile: relPath,
            packagePath: packageDir,
            isDev,
          });
        }
      };

      addSection(pkg.dependencies, false);
      addSection(pkg.devDependencies, true);
      addSection(pkg.peerDependencies, false);
    } catch {
      // Malformed JSON
    }
    return deps;
  }

  parseLockfile(_fileName: string, content: string): Map<string, string> {
    const resolved = new Map<string, string>();
    try {
      const lock = JSON.parse(content);
      // npm v2/v3 lockfile format
      if (lock.packages && typeof lock.packages === 'object') {
        for (const [key, val] of Object.entries(lock.packages)) {
          if (val && typeof val === 'object' && (val as any).version) {
            const pkgName = key.replace(/^node_modules\//, '');
            if (pkgName && !pkgName.includes('node_modules')) {
              resolved.set(pkgName, String((val as any).version));
            }
          }
        }
      }
      // npm v1 lockfile format fallback
      if (lock.dependencies && typeof lock.dependencies === 'object') {
        for (const [name, val] of Object.entries(lock.dependencies)) {
          if (val && typeof val === 'object' && (val as any).version) {
            resolved.set(name, String((val as any).version));
          }
        }
      }
    } catch {
      // Malformed lockfile
    }
    return resolved;
  }

  resolveVersions(
    deps: ProjectDependency[],
    pkgDir: string,
    lockfileCache: Map<string, Map<string, string>>
  ): void {
    const lockMap =
      lockfileCache.get('package-lock.json') ||
      lockfileCache.get(join(pkgDir, 'package-lock.json'));

    if (lockMap) {
      for (const dep of deps) {
        const resolved = lockMap.get(dep.name);
        if (resolved) dep.resolvedVersion = resolved;
      }
    }
  }
}
