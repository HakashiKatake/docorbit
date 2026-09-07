import type { ProjectDependency } from '../../../shared/src/index.ts';
import type { EcosystemStrategy } from './types.ts';

export class MavenStrategy implements EcosystemStrategy {
  readonly ecosystem = 'maven';
  readonly manifestNames = ['pom.xml'];

  parseManifest(_fileName: string, content: string, relPath: string, packageDir: string): ProjectDependency[] {
    const deps: ProjectDependency[] = [];
    const depRegex = /<dependency>([\s\S]*?)<\/dependency>/g;
    let match: RegExpExecArray | null;

    while ((match = depRegex.exec(content)) !== null) {
      const block = match[1];
      const groupMatch = block.match(/<groupId>([^<]+)<\/groupId>/);
      const artifactMatch = block.match(/<artifactId>([^<]+)<\/artifactId>/);
      const verMatch = block.match(/<version>([^<]+)<\/version>/);

      if (artifactMatch) {
        const name = groupMatch ? `${groupMatch[1]}:${artifactMatch[1]}` : artifactMatch[1];
        deps.push({
          name,
          ecosystem: 'maven',
          requestedVersion: verMatch ? verMatch[1].trim() : '*',
          resolvedVersion: verMatch ? verMatch[1].trim() : undefined,
          sourceFile: relPath,
          packagePath: packageDir,
          isDev: block.includes('<scope>test</scope>'),
        });
      }
    }
    return deps;
  }
}
