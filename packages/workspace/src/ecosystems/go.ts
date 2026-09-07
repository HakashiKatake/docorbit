import type { ProjectDependency } from '../../../shared/src/index.ts';
import type { EcosystemStrategy } from './types.ts';

export class GoStrategy implements EcosystemStrategy {
  readonly ecosystem = 'go';
  readonly manifestNames = ['go.mod'];

  parseManifest(_fileName: string, content: string, relPath: string, packageDir: string): ProjectDependency[] {
    const deps: ProjectDependency[] = [];
    const lines = content.split('\n');
    let inRequireBlock = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('require (')) {
        inRequireBlock = true;
        continue;
      }
      if (inRequireBlock && trimmed === ')') {
        inRequireBlock = false;
        continue;
      }

      if (inRequireBlock && trimmed && !trimmed.startsWith('//')) {
        const parts = trimmed.split(/\s+/);
        if (parts.length >= 2) {
          deps.push({
            name: parts[0],
            ecosystem: 'go',
            requestedVersion: parts[1],
            resolvedVersion: parts[1].replace(/^\+incompatible$/, ''),
            sourceFile: relPath,
            packagePath: packageDir,
            isDev: false,
          });
        }
      } else if (trimmed.startsWith('require ') && !trimmed.includes('(')) {
        const parts = trimmed.slice('require '.length).trim().split(/\s+/);
        if (parts.length >= 2) {
          deps.push({
            name: parts[0],
            ecosystem: 'go',
            requestedVersion: parts[1],
            resolvedVersion: parts[1].replace(/^\+incompatible$/, ''),
            sourceFile: relPath,
            packagePath: packageDir,
            isDev: false,
          });
        }
      }
    }
    return deps;
  }
}
