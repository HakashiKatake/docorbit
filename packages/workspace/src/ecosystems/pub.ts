import type { ProjectDependency } from '../../../shared/src/index.ts';
import type { EcosystemStrategy } from './types.ts';

export class PubStrategy implements EcosystemStrategy {
  readonly ecosystem = 'pub';
  readonly manifestNames = ['pubspec.yaml'];

  parseManifest(_fileName: string, content: string, relPath: string, packageDir: string): ProjectDependency[] {
    const deps: ProjectDependency[] = [];
    const lines = content.split('\n');
    let inDependencies = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === 'dependencies:' || trimmed === 'dev_dependencies:') {
        inDependencies = true;
        continue;
      }
      if (inDependencies && /^[a-zA-Z0-9_]+:/.test(line) && !line.startsWith(' ')) {
        inDependencies = false;
        continue;
      }

      if (inDependencies && trimmed && !trimmed.startsWith('#')) {
        const match = trimmed.match(/^([a-zA-Z0-9_]+)\s*:\s*(.+)$/);
        if (match && match[1] !== 'sdk' && match[1] !== 'flutter') {
          deps.push({
            name: match[1],
            ecosystem: 'pub',
            requestedVersion: match[2]?.trim() || '*',
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
