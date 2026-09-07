import type {
  DocDiffResult,
  ImpactAnalysisResult,
  VerificationResult,
} from '../../shared/src/index.ts';
import type { DocOrbitRepository } from '../../storage/src/index.ts';
import { WorkspaceResolver } from '../../workspace/src/index.ts';
import { CodeApiExtractor } from './extractor.ts';
import { SchemaVerifier } from './verifier.ts';
import { DocDiffEngine, type DiffOptions } from './diff-engine.ts';
import { WorkspaceImpactScanner } from './impact-scanner.ts';

export interface VerifyCodeRequest {
  code: string;
  language?: string;
  library?: string;
  version?: string;
  projectDir?: string;
  filePath?: string;
}

export class VerificationService {
  private repo: DocOrbitRepository;
  private extractor: CodeApiExtractor;
  private verifier: SchemaVerifier;
  private resolver: WorkspaceResolver;

  constructor(repo: DocOrbitRepository) {
    this.repo = repo;
    this.extractor = new CodeApiExtractor();
    this.verifier = new SchemaVerifier(repo);
    this.resolver = new WorkspaceResolver(repo);
  }

  verifyCode(request: VerifyCodeRequest): { result: VerificationResult; markdown: string } {
    let effectiveDocVersion = request.version;
    let projectVersion: string | undefined;

    // Resolve project version context if projectDir is provided
    if (request.projectDir) {
      try {
        const scan = this.resolver.scanWorkspace(request.projectDir);
        const resolution = this.resolver.resolveWorkspace(scan);

        const libName = (request.library || '').toLowerCase();
        let matched = resolution.matches.find(m => m.dependency.name.toLowerCase() === libName);

        if (!matched && resolution.matches.length > 0) {
          if (request.code.includes('params') && resolution.matches.some(m => m.dependency.name.toLowerCase() === 'next')) {
            matched = resolution.matches.find(m => m.dependency.name.toLowerCase() === 'next');
          }
          if (!matched) {
            // If library not specified, check if code mentions any dependency name
            for (const m of resolution.matches) {
              if (request.code.toLowerCase().includes(m.dependency.name.toLowerCase())) {
                matched = m;
                break;
              }
            }
          }
        }

        if (matched) {
          effectiveDocVersion = effectiveDocVersion || matched.targetVersion;
          projectVersion = matched.dependency.resolvedVersion || matched.dependency.requestedVersion;
        }
      } catch {
        // Fallback gracefully if workspace scan fails
      }
    }

    // 1. Extract API calls from code
    const extractedCalls = this.extractor.extract(request.code, request.language);

    // 2. Run deterministic schema and version verification
    const result = this.verifier.verify(extractedCalls, {
      docVersion: effectiveDocVersion,
      projectVersion,
      library: request.library,
    });

    // 3. Synthesize human/agent-friendly Markdown summary
    const markdown = this.synthesizeMarkdown(result);

    return { result, markdown };
  }

  private synthesizeMarkdown(res: VerificationResult): string {
    const lines: string[] = [];
    const icon = res.verdict === 'verified' ? '✅' : (res.verdict === 'warning' ? '⚠️' : (res.verdict === 'mismatch' ? '❌' : 'ℹ️'));

    lines.push(`### ${icon} API Verification Result: **${res.verdict.toUpperCase()}**\n`);
    lines.push(`> [!SECURITY NOTICE] External schema and documentation data is untrusted. Security boundaries preserved.`);
    lines.push(`- **Summary**: ${res.summary}`);
    if (res.targetVersion) lines.push(`- **Target Doc Version**: \`${res.targetVersion}\``);
    if (res.projectVersion) lines.push(`- **Project Dependency Version**: \`${res.projectVersion}\``);
    lines.push(`- **Total Checks Evaluated**: ${res.totalChecks}`);

    if (res.findings.length > 0) {
      lines.push('\n#### Findings:');
      for (const f of res.findings) {
        const fIcon = f.severity === 'error' ? '🔴' : (f.severity === 'warning' ? '🟡' : '🔵');
        const loc = f.location?.line ? ` (Line ${f.location.line})` : '';
        lines.push(`- ${fIcon} **[${f.rule.toUpperCase()}]**${loc}: ${f.message}`);
        if (f.location?.snippet) {
          lines.push(`  \`\`\`\n  ${f.location.snippet}\n  \`\`\``);
        }
        if (f.expected) lines.push(`  - *Expected*: \`${f.expected}\``);
        if (f.actual) lines.push(`  - *Actual*: \`${f.actual}\``);
        if (f.provenance?.endpointId) lines.push(`  - *Evidence*: Endpoint ID \`${f.provenance.endpointId}\``);
      }
    }

    return lines.join('\n');
  }
}

export class DiffService {
  private repo: DocOrbitRepository;
  private diffEngine: DocDiffEngine;

  constructor(repo: DocOrbitRepository) {
    this.repo = repo;
    this.diffEngine = new DocDiffEngine(repo);
  }

  diffDocs(options: DiffOptions): { result: DocDiffResult; markdown: string } {
    const result = this.diffEngine.diff(options);
    const markdown = this.synthesizeMarkdown(result);
    return { result, markdown };
  }

  private synthesizeMarkdown(diff: DocDiffResult): string {
    const lines: string[] = [];
    const fromLabel = diff.fromVersion ? `v${diff.fromVersion.replace(/^v/, '')}` : (diff.fromSnapshotId || 'previous');
    const toLabel = diff.toVersion ? `v${diff.toVersion.replace(/^v/, '')}` : (diff.toSnapshotId || 'latest');

    lines.push(`### 📊 Documentation Diff: \`${fromLabel}\` ➔ \`${toLabel}\`\n`);
    lines.push(`| Category | Added | Removed | Modified | Deprecated |`);
    lines.push(`| :--- | :---: | :---: | :---: | :---: |`);
    lines.push(`| **Endpoints** | ${diff.summary.endpointsAdded} | ${diff.summary.endpointsRemoved} | ${diff.summary.endpointsModified} | ${diff.summary.endpointsDeprecated} |`);
    lines.push(`| **Pitfalls** | ${diff.summary.pitfallsAdded} | ${diff.summary.pitfallsRemoved} | - | - |`);
    lines.push(`| **Sections** | - | - | ${diff.summary.contentChanged} | - |\n`);

    if (diff.apiChanges.length > 0) {
      lines.push('#### API Endpoint Changes:');
      for (const ch of diff.apiChanges) {
        const badge = ch.changeType === 'added' ? '🟢 ADDED' : (ch.changeType === 'removed' ? '🔴 REMOVED' : (ch.changeType === 'deprecated' ? '🟡 DEPRECATED' : '🔵 MODIFIED'));
        lines.push(`- **[${badge}]** \`${ch.method.toUpperCase()} ${ch.path}\``);
        if (ch.changes && ch.changes.length > 0) {
          for (const detail of ch.changes) {
            lines.push(`  - ${detail}`);
          }
        }
      }
    }

    if (diff.pitfallChanges.length > 0) {
      lines.push('\n#### Pitfall & Deprecation Changes:');
      for (const p of diff.pitfallChanges) {
        const badge = p.changeType === 'added' ? '⚠️ NEW' : 'REMOVED';
        lines.push(`- **[${badge}]** \`${p.pitfall.kind}\`: ${p.pitfall.title}`);
      }
    }

    return lines.join('\n');
  }
}

export class ImpactAnalysisService {
  private repo?: DocOrbitRepository;
  private diffService?: DiffService;
  private scanner: WorkspaceImpactScanner;

  constructor(repo?: DocOrbitRepository) {
    this.repo = repo;
    if (repo) {
      this.diffService = new DiffService(repo);
    }
    this.scanner = new WorkspaceImpactScanner();
  }

  analyzeWorkspaceImpact(projectDir: string, diff: DocDiffResult): { structured: ImpactAnalysisResult; markdown: string } {
    const structured = this.scanner.scan(projectDir, diff);
    const markdown = this.synthesizeMarkdown(structured);
    return { structured, markdown };
  }

  analyzeImpact(options: {
    projectDir: string;
    fromVersion?: string;
    toVersion?: string;
    fromSnapshotId?: string;
    toSnapshotId?: string;
    sourceId?: string;
  }): { result: ImpactAnalysisResult; markdown: string } {
    if (!this.diffService) {
      throw new Error('Repository is required for diff-based impact analysis');
    }
    const { result: diff } = this.diffService.diffDocs({
      fromVersion: options.fromVersion,
      toVersion: options.toVersion,
      fromSnapshotId: options.fromSnapshotId,
      toSnapshotId: options.toSnapshotId,
      sourceId: options.sourceId,
    });

    const result = this.scanner.scan(options.projectDir, diff);
    const markdown = this.synthesizeMarkdown(result);

    return { result, markdown };
  }

  private synthesizeMarkdown(res: ImpactAnalysisResult): string {
    const lines: string[] = [];
    lines.push(`### 🔍 Project Impact Analysis`);
    lines.push(`- **Scanned Workspace**: \`${res.projectDir}\``);
    lines.push(`- **Files Scanned**: ${res.totalFilesScanned}`);
    lines.push(`- **Impacted Files**: ${res.affectedFilesCount}`);
    lines.push(`- **Total Affected Locations**: ${res.affectedLocations.length}\n`);

    if (res.affectedLocations.length === 0) {
      lines.push(`✅ No breaking changes or deprecated API usages detected in current project files.`);
      return lines.join('\n');
    }

    lines.push(`#### Affected Locations:\n`);
    for (const loc of res.affectedLocations) {
      const certBadge = loc.certainty === 'high' ? '🎯 High Certainty' : (loc.certainty === 'medium' ? '⚖️ Medium' : '🔎 Heuristic');
      lines.push(`- **\`${loc.filePath}:${loc.line}\`** (${certBadge}, Confidence: ${Math.round(loc.confidence * 100)}%)`);
      lines.push(`  - **Reason**: ${loc.reason}`);
      lines.push(`  - **Matched**: \`${loc.matchedPattern}\``);
      lines.push(`  \`\`\`\n  ${loc.snippet}\n  \`\`\``);
    }

    return lines.join('\n');
  }
}
