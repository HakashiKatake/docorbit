import type { ProjectDependency } from '../../../shared/src/index.ts';
import type { EcosystemStrategy } from './types.ts';

export class RubyGemsStrategy implements EcosystemStrategy {
  readonly ecosystem = 'rubygems';
  readonly manifestNames = ['gemfile'];

  parseManifest(_fileName: string, content: string, relPath: string, packageDir: string): ProjectDependency[] {
    const deps: ProjectDependency[] = [];
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('gem ') || trimmed.startsWith("gem\t")) {
        const match = trimmed.match(/^gem\s+['"]([^'"]+)['"](?:\s*,\s*['"]([^'"]+)['"])?/);
        if (match) {
          deps.push({
            name: match[1],
            ecosystem: 'rubygems',
            requestedVersion: match[2] || '*',
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
