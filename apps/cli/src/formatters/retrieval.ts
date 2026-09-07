import type { SearchResult, ContextPackage } from '../../../../packages/shared/src/index.ts';
import { RESET, BOLD, DIM, GREEN, CYAN, YELLOW, MAGENTA } from './colors.ts';

export function formatSearchResults(query: string, results: SearchResult[]): string {
  const lines: string[] = [];

  lines.push('');
  lines.push(`${BOLD}${CYAN}DocOrbit${RESET} ${DIM}— Search Results for: "${query}"${RESET}`);
  lines.push(`${DIM}${'═'.repeat(64)}${RESET}`);

  if (results.length === 0) {
    lines.push(`  ${YELLOW}No matching documentation chunks found.${RESET}`);
    lines.push(`${DIM}${'═'.repeat(64)}${RESET}`);
    lines.push('');
    return lines.join('\n');
  }

  for (let i = 0; i < results.length; i++) {
    const res = results[i];
    const chunk = res.chunk;
    const breadcrumb = chunk.sectionPath.length > 0 ? chunk.sectionPath.join(' > ') : (chunk.title || 'General');

    lines.push(`  ${BOLD}${i + 1}.${RESET} ${CYAN}${breadcrumb}${RESET} ${GREEN}(Score: ${res.score})${RESET}`);
    lines.push(`     ${DIM}Type: ${chunk.chunkType} | Est. Tokens: ~${chunk.tokenEstimate} | Chunk: ${chunk.id}${RESET}`);
    if (res.matchReasons.length > 0) {
      lines.push(`     ${DIM}Matches: ${res.matchReasons.join(' • ')}${RESET}`);
    }
    if (res.symbols.length > 0) {
      lines.push(`     ${MAGENTA}Symbols: ${res.symbols.map(s => s.name).join(', ')}${RESET}`);
    }

    const preview = chunk.content.split('\n').filter(l => l.trim().length > 0).slice(0, 3).join('\n     ');
    lines.push(`     ${DIM}│${RESET} ${preview}`);
    lines.push('');
  }

  lines.push(`${DIM}${'═'.repeat(64)}${RESET}`);
  lines.push('');
  return lines.join('\n');
}

export function formatContextPackage(pkg: ContextPackage): string {
  const lines: string[] = [];

  lines.push('');
  lines.push(`${BOLD}${GREEN}DocOrbit${RESET} ${DIM}— Assembled Context Package${RESET}`);
  lines.push(`${DIM}${'═'.repeat(64)}${RESET}`);
  lines.push(`${BOLD}Task:${RESET}             ${CYAN}${pkg.task}${RESET}`);
  lines.push(`${BOLD}Detected Intent:${RESET}  ${MAGENTA}${pkg.detectedIntent}${RESET}`);
  lines.push(`${BOLD}Estimated Tokens:${RESET} ~${pkg.totalEstimatedTokens} / ${pkg.tokenBudget} (heuristic)`);
  lines.push(`${BOLD}Chunks Included:${RESET}  ${pkg.chunks.length}`);
  lines.push(`${BOLD}Sources Cited:${RESET}    ${pkg.sources.length > 0 ? pkg.sources.join(', ') : 'Local documentation'}`);

  if (pkg.warnings.length > 0) {
    lines.push('');
    lines.push(`${YELLOW}${BOLD}Advisories & Warnings (${pkg.warnings.length}):${RESET}`);
    for (const w of pkg.warnings) {
      lines.push(`  ${YELLOW}⚠ ${w}${RESET}`);
    }
  }

  lines.push('');
  lines.push(`${BOLD}Package Markdown Preview:${RESET}`);
  lines.push(`${DIM}${'─'.repeat(64)}${RESET}`);
  const previewLines = pkg.markdown.split('\n').slice(0, 20);
  lines.push(previewLines.join('\n'));
  if (pkg.markdown.split('\n').length > 20) {
    lines.push(`\n${DIM}... (${pkg.markdown.split('\n').length - 20} more lines in full package)${RESET}`);
  }
  lines.push(`${DIM}${'═'.repeat(64)}${RESET}`);
  lines.push('');

  return lines.join('\n');
}
