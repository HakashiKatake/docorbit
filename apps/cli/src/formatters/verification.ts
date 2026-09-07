import type {
  DocDiffResult,
  ImpactAnalysisResult,
  VerificationResult,
} from '../../../../packages/shared/src/index.ts';
import { RESET, BOLD, DIM, GREEN, CYAN, YELLOW, RED } from './colors.ts';

export function formatVerificationReport(result: VerificationResult): string {
  const lines: string[] = [];
  const verdictColor =
    result.verdict === 'verified'
      ? GREEN
      : result.verdict === 'warning'
      ? YELLOW
      : result.verdict === 'mismatch'
      ? RED
      : CYAN;

  lines.push(`${BOLD}${CYAN}DocOrbit — Code & Schema Verification${RESET}`);
  lines.push(`Verdict: ${verdictColor}${BOLD}${result.verdict.toUpperCase()}${RESET}`);
  lines.push(`Summary: ${result.summary}`);
  if (result.targetVersion) {
    lines.push(`Target Version:  ${YELLOW}${result.targetVersion}${RESET}`);
  }
  if (result.projectVersion) {
    lines.push(`Project Version: ${YELLOW}${result.projectVersion}${RESET}`);
  }
  lines.push(`Total Checks:    ${result.totalChecks}\n`);

  if (result.findings.length === 0) {
    lines.push(`${GREEN}✔ No schema mismatches, deprecations, or syntax issues detected.${RESET}`);
    return lines.join('\n');
  }

  lines.push(`${BOLD}Findings (${result.findings.length}):${RESET}`);
  for (const f of result.findings) {
    const fColor = f.severity === 'error' ? RED : f.severity === 'warning' ? YELLOW : CYAN;
    const loc = f.location?.line ? ` (Line ${f.location.line})` : '';
    lines.push(`  ${fColor}• [${f.rule.toUpperCase()}]${loc}: ${f.message}${RESET}`);
    if (f.location?.snippet) {
      lines.push(`    ${DIM}${f.location.snippet}${RESET}`);
    }
    if (f.expected) {
      lines.push(`    ${DIM}Expected: ${String(f.expected)}${RESET}`);
    }
    if (f.actual) {
      lines.push(`    ${DIM}Actual:   ${String(f.actual)}${RESET}`);
    }
  }

  return lines.join('\n');
}

export function formatDiffReport(diff: DocDiffResult): string {
  const lines: string[] = [];
  const from = diff.fromVersion || diff.fromSnapshotId || 'previous';
  const to = diff.toVersion || diff.toSnapshotId || 'latest';

  lines.push(`${BOLD}${CYAN}DocOrbit — Documentation & API Diff${RESET}`);
  lines.push(`Comparing: ${YELLOW}${from}${RESET} ➔ ${YELLOW}${to}${RESET}`);
  lines.push(`Endpoints: +${diff.summary.endpointsAdded} added, -${diff.summary.endpointsRemoved} removed, ~${diff.summary.endpointsModified} modified, !${diff.summary.endpointsDeprecated} deprecated`);
  lines.push(`Pitfalls:  +${diff.summary.pitfallsAdded} added, -${diff.summary.pitfallsRemoved} removed\n`);

  if (diff.apiChanges.length > 0) {
    lines.push(`${BOLD}API Endpoint Changes:${RESET}`);
    for (const ep of diff.apiChanges) {
      const badge =
        ep.changeType === 'added'
          ? `${GREEN}[ADDED]${RESET}`
          : ep.changeType === 'removed'
          ? `${RED}[REMOVED]${RESET}`
          : ep.changeType === 'deprecated'
          ? `${YELLOW}[DEPRECATED]${RESET}`
          : `${CYAN}[MODIFIED]${RESET}`;

      lines.push(`  ${badge} ${ep.method.toUpperCase()} ${ep.path}`);
      if (ep.changes) {
        for (const ch of ep.changes) {
          lines.push(`    ${DIM}• ${ch}${RESET}`);
        }
      }
    }
    lines.push('');
  }

  if (diff.pitfallChanges.length > 0) {
    lines.push(`${BOLD}Pitfall Changes:${RESET}`);
    for (const p of diff.pitfallChanges) {
      const badge = p.changeType === 'added' ? `${YELLOW}[NEW WARNING]${RESET}` : `${DIM}[REMOVED]${RESET}`;
      lines.push(`  ${badge} ${p.pitfall.kind}: ${p.pitfall.title}`);
    }
  }

  return lines.join('\n');
}

export function formatImpactReport(impact: ImpactAnalysisResult): string {
  const lines: string[] = [];
  lines.push(`${BOLD}${CYAN}DocOrbit — Project Impact Analysis${RESET}`);
  lines.push(`Workspace:      ${impact.projectDir}`);
  lines.push(`Files Scanned:  ${impact.totalFilesScanned}`);
  lines.push(`Impacted Files: ${impact.affectedFilesCount}`);
  lines.push(`Total Matches:  ${impact.affectedLocations.length}\n`);

  if (impact.affectedLocations.length === 0) {
    lines.push(`${GREEN}✔ Zero project files impacted by documentation/API changes.${RESET}`);
    return lines.join('\n');
  }

  lines.push(`${BOLD}Impacted Locations:${RESET}`);
  for (const loc of impact.affectedLocations) {
    const cert =
      loc.certainty === 'high'
        ? `${RED}[HIGH]${RESET}`
        : loc.certainty === 'medium'
        ? `${YELLOW}[MED]${RESET}`
        : `${DIM}[HEUR]${RESET}`;

    lines.push(`  ${cert} ${BOLD}${loc.filePath}:${loc.line}${RESET}`);
    lines.push(`    ${YELLOW}Reason:  ${loc.reason}${RESET}`);
    lines.push(`    ${DIM}Pattern: ${loc.matchedPattern}${RESET}`);
    lines.push(`    ${DIM}Snippet: ${loc.snippet}${RESET}\n`);
  }

  return lines.join('\n');
}
