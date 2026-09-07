import type { ProjectDependency } from '../../../shared/src/index.ts';
import type { EcosystemStrategy } from './types.ts';

export class ComposerStrategy implements EcosystemStrategy {
  readonly ecosystem = 'composer';
  readonly manifestNames = ['composer.json'];

  parseManifest(_fileName: string, content: string, relPath: string, packageDir: string): ProjectDependency[] {
    const deps: ProjectDependency[] = [];
    try {
      const composer = JSON.parse(content);
      if (composer.require && typeof composer.require === 'object') {
        for (const [name, ver] of Object.entries(composer.require)) {
          if (name === 'php') continue;
          deps.push({
            name,
            ecosystem: 'composer',
            requestedVersion: String(ver),
            sourceFile: relPath,
            packagePath: packageDir,
            isDev: false,
          });
        }
      }
      if (composer['require-dev'] && typeof composer['require-dev'] === 'object') {
        for (const [name, ver] of Object.entries(composer['require-dev'])) {
          deps.push({
            name,
            ecosystem: 'composer',
            requestedVersion: String(ver),
            sourceFile: relPath,
            packagePath: packageDir,
            isDev: true,
          });
        }
      }
    } catch {
      // Ignore malformed JSON
    }
    return deps;
  }
}
