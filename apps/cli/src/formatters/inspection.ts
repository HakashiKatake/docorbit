import type { InspectionReport, IngestionResult } from '../../../../packages/core/src/index.ts';
import { RESET, BOLD, DIM, GREEN, BLUE, CYAN, YELLOW, RED, MAGENTA } from './colors.ts';

export function formatInspectionReport(report: InspectionReport): string {
  const lines: string[] = [];

  lines.push('');
  lines.push(`${BOLD}${CYAN}DocOrbit${RESET} ${DIM}— Documentation Intelligence Report${RESET}`);
  lines.push(`${DIM}${'═'.repeat(64)}${RESET}`);
  lines.push(`${BOLD}Target URL:${RESET} ${BLUE}${report.targetUrl}${RESET}`);
  lines.push('');

  // Sources Table
  lines.push(`${BOLD}Discovered Sources (${report.summary.totalFound}):${RESET}`);
  lines.push(`${DIM}${'─'.repeat(64)}${RESET}`);

  if (report.sourcesDiscovered.length === 0) {
    lines.push(`  ${YELLOW}No machine-readable sources discovered.${RESET}`);
  } else {
    for (const src of report.sourcesDiscovered) {
      const icon = src.status === 'valid' ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
      const typeStr = `[${src.type}]`.padEnd(16);
      const mr = src.machineReadable ? `${GREEN}machine-readable${RESET}` : `${DIM}human-html${RESET}`;
      const auth = `${src.authority}`;
      lines.push(`  ${icon} ${BOLD}${typeStr}${RESET} ${mr.padEnd(26)} ${DIM}(${auth}, conf: ${Math.round(src.confidence * 100)}%)${RESET}`);
      lines.push(`    ${DIM}↳ ${src.url}${RESET}`);
    }
  }

  lines.push('');
  lines.push(`${BOLD}Purpose-Based Source Recommendations:${RESET}`);
  lines.push(`${DIM}${'─'.repeat(64)}${RESET}`);

  const purposes = [
    { key: 'navigation', label: 'Navigation    ' },
    { key: 'conceptual', label: 'Conceptual    ' },
    { key: 'api',        label: 'API Reference ' },
    { key: 'examples',   label: 'Code Examples ' },
    { key: 'implementation', label: 'Implementation' },
  ] as const;

  for (const p of purposes) {
    const rec = report.recommendations[p.key];
    if (rec && rec.recommended) {
      lines.push(`  ${CYAN}${p.label}${RESET} → ${GREEN}${rec.recommended.type}${RESET} ${DIM}(${rec.recommended.url})${RESET}`);
    } else {
      lines.push(`  ${CYAN}${p.label}${RESET} → ${DIM}No dedicated source${RESET}`);
    }
  }

  lines.push('');
  lines.push(`${BOLD}Summary:${RESET}`);
  lines.push(`  Machine-readable sources: ${GREEN}${report.summary.machineReadableCount}${RESET}`);
  lines.push(`  Official sources:         ${GREEN}${report.summary.officialCount}${RESET}`);
  lines.push(`  OpenAPI detected:         ${report.summary.hasOpenApi ? `${GREEN}Yes${RESET}` : `${DIM}No${RESET}`}`);
  lines.push(`  llms.txt detected:        ${report.summary.hasLlmsTxt ? `${GREEN}Yes${RESET}` : `${DIM}No${RESET}`}`);
  lines.push(`  skill.md detected:        ${report.summary.hasSkill ? `${GREEN}Yes${RESET}` : `${DIM}No${RESET}`}`);
  lines.push(`${DIM}${'═'.repeat(64)}${RESET}`);
  lines.push('');

  return lines.join('\n');
}

export function formatIngestionResult(result: IngestionResult): string {
  const lines: string[] = [];

  lines.push('');
  lines.push(`${BOLD}${GREEN}DocOrbit${RESET} ${DIM}— Documentation Ingested Successfully${RESET}`);
  lines.push(`${DIM}${'═'.repeat(64)}${RESET}`);
  lines.push(`${BOLD}Target URL:${RESET}  ${BLUE}${result.targetUrl}${RESET}`);
  lines.push(`${BOLD}Snapshot ID:${RESET} ${MAGENTA}${result.snapshotId}${RESET}`);
  lines.push(`${BOLD}Duration:${RESET}    ${result.durationMs}ms`);
  lines.push('');

  lines.push(`${BOLD}Ingested Pages (${result.pages.length}):${RESET}`);
  lines.push(`${DIM}${'─'.repeat(64)}${RESET}`);

  for (let i = 0; i < result.pages.length; i++) {
    const p = result.pages[i];
    const warnBadge = p.securityAnnotations.length > 0
      ? ` ${YELLOW}[${p.securityAnnotations.length} alert(s)]${RESET}`
      : '';
    lines.push(`  ${BOLD}${i + 1}.${RESET} ${CYAN}${p.title}${RESET}${warnBadge}`);
    lines.push(`     ${DIM}URL:    ${p.url}${RESET}`);
    lines.push(`     ${DIM}Tokens: ~${p.estimatedTokens} | Code blocks: ${p.codeExamples.length} | Hash: ${p.contentHash.slice(0, 8)}${RESET}`);
  }

  lines.push('');
  lines.push(`${BOLD}Ingestion Summary:${RESET}`);
  lines.push(`  Total Pages:            ${BOLD}${result.stats.totalPages}${RESET}`);
  lines.push(`  Total Raw Bytes:        ${(result.stats.totalBytes / 1024).toFixed(1)} KB`);
  lines.push(`  Estimated Tokens:       ~${result.stats.totalEstimatedTokens}`);
  lines.push(`  Total Code Examples:    ${result.stats.totalCodeExamples}`);
  lines.push(`  Machine-readable types: ${result.stats.machineReadableSources}`);
  if (result.stats.totalChunks !== undefined) {
    lines.push(`  Total Chunks:           ${BOLD}${result.stats.totalChunks}${RESET}`);
  }
  lines.push(`${DIM}${'═'.repeat(64)}${RESET}`);
  lines.push('');

  return lines.join('\n');
}
