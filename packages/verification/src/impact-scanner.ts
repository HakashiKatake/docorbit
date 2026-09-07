import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  AffectedFileLocation,
  DocDiffResult,
  ImpactAnalysisResult,
} from '../../shared/src/index.ts';

const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.json',
]);

const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.docorbit', 'dist', 'build', '.next', 'coverage',
]);

export class WorkspaceImpactScanner {
  /**
   * Scans a workspace project directory and identifies files affected by documentation diffs.
   */
  scan(projectDir: string, diff: DocDiffResult): ImpactAnalysisResult {
    const files = this.collectFiles(projectDir);
    const affectedLocations: AffectedFileLocation[] = [];

    for (const filePath of files) {
      this.analyzeFile(filePath, projectDir, diff, affectedLocations);
    }

    const uniqueFiles = new Set(affectedLocations.map(loc => loc.filePath));

    let summary: string;
    if (affectedLocations.length === 0) {
      summary = `No project files affected across ${files.length} scanned file(s).`;
    } else {
      summary = `Found ${affectedLocations.length} affected location(s) across ${uniqueFiles.size} file(s).`;
    }

    return {
      projectDir,
      fromVersion: diff.fromVersion,
      toVersion: diff.toVersion,
      totalFilesScanned: files.length,
      affectedFilesCount: uniqueFiles.size,
      affectedLocations,
      summary,
    };
  }

  private collectFiles(dir: string): string[] {
    const results: string[] = [];
    if (!fs.existsSync(dir)) return results;

    const traverse = (currentDir: string) => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(currentDir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (IGNORED_DIRS.has(entry.name)) continue;

        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          traverse(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (SOURCE_EXTENSIONS.has(ext)) {
            results.push(fullPath);
          }
        }
      }
    };

    traverse(dir);
    return results;
  }

  private analyzeFile(
    fullPath: string,
    projectDir: string,
    diff: DocDiffResult,
    out: AffectedFileLocation[]
  ): void {
    let content: string;
    try {
      content = fs.readFileSync(fullPath, 'utf8');
    } catch {
      return;
    }

    const relPath = path.relative(projectDir, fullPath);
    const lines = content.split('\n');

    // Quick pre-filter: check imports
    const hasStripe = content.includes('stripe');
    const hasNext = content.includes('next');

    // 1. Scan for API endpoint removals, deprecations, and parameter modifications
    for (const apiChange of diff.apiChanges) {
      const epPath = apiChange.path;
      const cleanPath = epPath.replace(/^\//, '');

      for (let i = 0; i < lines.length; i++) {
        const lineText = lines[i];

        // Check if line contains endpoint path
        if (lineText.includes(epPath) || lineText.includes(`'${cleanPath}'`) || lineText.includes(`"${cleanPath}"`)) {
          if (apiChange.changeType === 'removed') {
            out.push({
              filePath: relPath,
              line: i + 1,
              snippet: lineText.trim(),
              reason: `Endpoint "${apiChange.method.toUpperCase()} ${epPath}" was removed in API documentation.`,
              matchedPattern: epPath,
              changeCategory: 'removed_api',
              certainty: 'high',
              confidence: 0.95,
              relatedChange: { endpoint: epPath },
            });
          } else if (apiChange.changeType === 'deprecated') {
            out.push({
              filePath: relPath,
              line: i + 1,
              snippet: lineText.trim(),
              reason: `Endpoint "${apiChange.method.toUpperCase()} ${epPath}" is deprecated in API documentation.`,
              matchedPattern: epPath,
              changeCategory: 'deprecated_api',
              certainty: 'high',
              confidence: 0.9,
              relatedChange: { endpoint: epPath },
            });
          } else if (apiChange.changeType === 'modified') {
            out.push({
              filePath: relPath,
              line: i + 1,
              snippet: lineText.trim(),
              reason: `Endpoint parameters/schemas changed: ${(apiChange.changes || []).join('; ')}`,
              matchedPattern: epPath,
              changeCategory: 'modified_parameters',
              certainty: 'high',
              confidence: 0.85,
              relatedChange: { endpoint: epPath },
            });
          }
        }
      }
    }

    // 2. Scan for breaking pitfalls and deprecations
    for (const pitChange of diff.pitfallChanges) {
      const pit = pitChange.pitfall;
      if (pitChange.changeType !== 'added') continue;

      const matchedLinesForThisPitfall = new Set<number>();

      // Next.js Route Params sync deprecation / removal
      if (pit.content.includes('params.slug') || pit.title.includes('route params') || pit.title.includes('Route Parameters')) {
        for (let i = 0; i < lines.length; i++) {
          const lineText = lines[i];
          if (lineText.includes('params.') && !lineText.includes('await params') && hasNext) {
            matchedLinesForThisPitfall.add(i + 1);
            out.push({
              filePath: relPath,
              line: i + 1,
              snippet: lineText.trim(),
              reason: `Synchronous route parameter access detected. Documentation deprecation notice: ${pit.title}`,
              matchedPattern: 'params.',
              changeCategory: 'breaking_pitfall',
              certainty: hasNext ? 'medium' : 'heuristic',
              confidence: hasNext ? 0.85 : 0.6,
              relatedChange: { pitfallTitle: pit.title },
            });
          }
        }
      }

      // Check symbol references
      if (pit.relatedSymbol) {
        for (let i = 0; i < lines.length; i++) {
          if (matchedLinesForThisPitfall.has(i + 1)) continue;
          const lineText = lines[i];
          if (lineText.includes(pit.relatedSymbol)) {
            matchedLinesForThisPitfall.add(i + 1);
            out.push({
              filePath: relPath,
              line: i + 1,
              snippet: lineText.trim(),
              reason: `Symbol "${pit.relatedSymbol}" referenced in file has documented pitfall: ${pit.title}`,
              matchedPattern: pit.relatedSymbol,
              changeCategory: 'breaking_pitfall',
              certainty: (hasStripe || hasNext) ? 'medium' : 'heuristic',
              confidence: (hasStripe || hasNext) ? 0.8 : 0.5,
              relatedChange: { symbol: pit.relatedSymbol, pitfallTitle: pit.title },
            });
          }
        }
      }
    }
  }
}
