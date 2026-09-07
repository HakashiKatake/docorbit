import type { ProjectDependency } from '../../../shared/src/index.ts';
import type { EcosystemStrategy } from './types.ts';

export class PyPiStrategy implements EcosystemStrategy {
  readonly ecosystem = 'pypi';
  readonly manifestNames = ['requirements.txt', 'pyproject.toml'];

  parseManifest(fileName: string, content: string, relPath: string, packageDir: string): ProjectDependency[] {
    const lower = fileName.toLowerCase();
    if (lower === 'requirements.txt') {
      return this.parseRequirementsTxt(content, relPath, packageDir);
    }
    if (lower === 'pyproject.toml') {
      return this.parsePyprojectToml(content, relPath, packageDir);
    }
    return [];
  }

  private parseRequirementsTxt(content: string, relPath: string, packageDir: string): ProjectDependency[] {
    const deps: ProjectDependency[] = [];
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-')) continue;

      // Match name and version specifier (e.g. requests==2.31.0, flask>=3.0.0, numpy)
      const match = trimmed.match(/^([a-zA-Z0-9_.-]+)\s*([=><~^!].*)?$/);
      if (match) {
        const name = match[1];
        const spec = match[2]?.trim() || '*';
        const exactMatch = spec.match(/^==\s*([a-zA-Z0-9_.-]+)$/);
        deps.push({
          name,
          ecosystem: 'pypi',
          requestedVersion: spec,
          resolvedVersion: exactMatch ? exactMatch[1] : undefined,
          sourceFile: relPath,
          packagePath: packageDir,
          isDev: false,
        });
      }
    }
    return deps;
  }

  private parsePyprojectToml(content: string, relPath: string, packageDir: string): ProjectDependency[] {
    const deps: ProjectDependency[] = [];
    const lines = content.split('\n');
    let inDependencies = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        const sec = trimmed.slice(1, -1).trim();
        inDependencies =
          sec === 'project.dependencies' ||
          sec === 'tool.poetry.dependencies' ||
          sec === 'project.optional-dependencies';
        continue;
      }

      if (inDependencies && trimmed && !trimmed.startsWith('#')) {
        // Poetry format: name = "^1.2.3" or name = { version = "1.2.3" }
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx !== -1) {
          const name = trimmed.slice(0, eqIdx).trim();
          if (name.toLowerCase() === 'python') continue;
          const val = trimmed.slice(eqIdx + 1).trim();
          let ver = '*';
          const vMatch = val.match(/"([^"]+)"/);
          if (vMatch) ver = vMatch[1];
          deps.push({
            name,
            ecosystem: 'pypi',
            requestedVersion: ver,
            sourceFile: relPath,
            packagePath: packageDir,
            isDev: false,
          });
        } else if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
          // Standard PEP 621: "requests>=2.28.0",
          const clean = trimmed.replace(/^[",']|[",']$/g, '');
          const match = clean.match(/^([a-zA-Z0-9_.-]+)\s*([=><~^!].*)?$/);
          if (match) {
            deps.push({
              name: match[1],
              ecosystem: 'pypi',
              requestedVersion: match[2]?.trim() || '*',
              sourceFile: relPath,
              packagePath: packageDir,
              isDev: false,
            });
          }
        }
      }
    }
    return deps;
  }
}
