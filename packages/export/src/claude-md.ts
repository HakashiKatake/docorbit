import type {
  ApiEndpoint,
  Pitfall,
  ProjectDependency,
  VersionResolutionResult,
} from '../../shared/src/index.ts';

export interface ClaudeMdExportData {
  projectDir?: string;
  docVersion?: string;
  dependencies: Array<{
    dep: ProjectDependency;
    resolution?: VersionResolutionResult;
  }>;
  endpoints: ApiEndpoint[];
  pitfalls: Pitfall[];
  sources: string[];
}

/**
 * Generates a CLAUDE.md developer and agent guide tailored for Claude Code.
 * Extracts deterministic rules, caveats, verification CLI commands, and API signatures.
 */
export function generateClaudeMd(data: ClaudeMdExportData): string {
  const lines: string[] = [];

  lines.push('# CLAUDE.md — Agent Working Rules & Documentation Contracts');
  lines.push('');
  lines.push('> [!IMPORTANT]');
  lines.push('> **Version-Grounded Rules**: This codebase uses DocOrbit for deterministic documentation intelligence.');
  lines.push('> Never hallucinate or assume unpinned library versions. All rules and caveats below are extracted');
  lines.push('> from authoritative indexed documentation (`untrusted: true`).');
  lines.push('');

  // 1. Architecture & Tech Stack
  lines.push('## 1. Project Architecture & Dependencies');
  lines.push('');
  if (data.dependencies.length > 0) {
    const sortedDeps = [...data.dependencies].sort((a, b) => a.dep.name.localeCompare(b.dep.name));
    for (const item of sortedDeps) {
      const dep = item.dep;
      const res = item.resolution;
      const ver = res?.targetVersion || dep.resolvedVersion || dep.requestedVersion;
      const confidence = res ? ` (doc match confidence: ${(res.confidence * 100).toFixed(0)}%)` : '';
      lines.push(`- **${dep.name}**: \`${ver}\` [${dep.ecosystem}]${confidence}`);
    }
    lines.push('');
  } else if (data.docVersion) {
    lines.push(`- Pinned Documentation Scope: \`${data.docVersion}\``);
    lines.push('');
  } else {
    lines.push('- *No project manifests detected; relying on indexed documentation.*');
    lines.push('');
  }

  // 2. Deterministic Verification Commands
  lines.push('## 2. DocOrbit Verification Commands');
  lines.push('');
  lines.push('Run these commands before committing generated code:');
  lines.push('```bash');
  lines.push('# Verify generated code snippet or file against indexed schemas');
  lines.push('docorbit verify "<code-or-file-path>"');
  lines.push('');
  lines.push('# Check documentation diff across versions (e.g. v14 to v15)');
  lines.push('docorbit diff --from v14 --to v15');
  lines.push('');
  lines.push('# Scan project repository for code impacted by API breaking changes');
  lines.push('docorbit impact --from v14 --to v15 --project .');
  lines.push('```');
  lines.push('');

  // 3. Hard Rules & Caveats (From Pitfalls)
  lines.push('## 3. Hard Rules & Caveats');
  lines.push('');
  if (data.pitfalls.length > 0) {
    const sortedPitfalls = [...data.pitfalls].sort((a, b) => {
      const severityOrder: Record<string, number> = { error: 0, warning: 1, info: 2 };
      const sA = severityOrder[a.severity || 'warning'] ?? 1;
      const sB = severityOrder[b.severity || 'warning'] ?? 1;
      if (sA !== sB) return sA - sB;
      return a.title.localeCompare(b.title);
    });

    for (const pf of sortedPitfalls) {
      const prefix = pf.kind === 'removed' || pf.kind === 'breaking_change' || pf.severity === 'error' ? 'NEVER' : 'ALWAYS';
      const versionNote = pf.affectedVersions?.target || pf.docVersion ? ` (Version: \`${pf.affectedVersions?.target || pf.docVersion}\`)` : '';
      lines.push(`- **${prefix}**: ${pf.title}${versionNote}`);
      lines.push(`  - Caveat: ${pf.message}`);
      if (pf.mitigation) {
        lines.push(`  - Fix: ${pf.mitigation}`);
      }
    }
    lines.push('');
  } else {
    lines.push('- *No explicit warnings or pitfalls recorded.*');
    lines.push('');
  }

  // 4. Verified API Endpoints
  lines.push('## 4. Key API Signatures');
  lines.push('');
  if (data.endpoints.length > 0) {
    const sortedEndpoints = [...data.endpoints].sort((a, b) => {
      const cmp = a.path.localeCompare(b.path);
      return cmp !== 0 ? cmp : a.method.localeCompare(b.method);
    });

    for (const ep of sortedEndpoints) {
      const req = ep.parameters?.filter(p => p.required).map(p => p.name).join(', ') || 'none';
      const opt = ep.parameters?.filter(p => !p.required).map(p => p.name).join(', ') || 'none';
      const depNotice = ep.deprecated ? ' *(deprecated)*' : '';
      lines.push(`- \`${ep.method.toUpperCase()} ${ep.path}\`${depNotice}:`);
      if (ep.summary) {
        lines.push(`  - Summary: ${ep.summary}`);
      }
      lines.push(`  - Required parameters: \`${req}\``);
      if (opt !== 'none') {
        lines.push(`  - Optional parameters: \`${opt}\``);
      }
    }
    lines.push('');
  } else {
    lines.push('- *No indexed endpoints.*');
    lines.push('');
  }

  // 5. Security & Provenance
  lines.push('## 5. Provenance Notice');
  lines.push('');
  lines.push('All external documentation indexed by DocOrbit is treated as untrusted third-party input.');
  if (data.sources.length > 0) {
    const sortedSources = [...data.sources].sort();
    lines.push('Sources:');
    for (const s of sortedSources) {
      lines.push(`- \`${s}\``);
    }
  }
  lines.push('');

  return lines.join('\n');
}
