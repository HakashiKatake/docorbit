import type {
  ApiEndpoint,
  IndexedExample,
  Pitfall,
  Recipe,
} from '../../../../packages/shared/src/index.ts';
import { RESET, BOLD, DIM, GREEN, BLUE, CYAN, YELLOW, RED, MAGENTA } from './colors.ts';

export function formatApiEndpoints(
  endpoints: ApiEndpoint[],
  query?: string
): string {
  const lines: string[] = [];

  lines.push('');
  lines.push(`${BOLD}${CYAN}DocOrbit${RESET} ${DIM}— API Intelligence for: "${query || '*'}"${RESET}`);
  lines.push(`${DIM}${'═'.repeat(64)}${RESET}`);

  if (endpoints.length === 0) {
    lines.push(`  ${YELLOW}No matching API endpoints found.${RESET}`);
    lines.push(`${DIM}${'═'.repeat(64)}${RESET}`);
    lines.push('');
    return lines.join('\n');
  }

  for (let i = 0; i < endpoints.length; i++) {
    const ep = endpoints[i];
    let methodColor = GREEN;
    if (ep.method === 'post') methodColor = BLUE;
    else if (ep.method === 'put') methodColor = YELLOW;
    else if (ep.method === 'delete') methodColor = RED;
    else if (ep.method === 'patch') methodColor = MAGENTA;

    const methodBadge = `${methodColor}${BOLD}[${ep.method.toUpperCase()}]${RESET}`;
    const depBadge = ep.deprecated ? ` ${RED}${BOLD}[DEPRECATED]${RESET}` : '';
    const verBadge = ep.docVersion ? ` ${DIM}(${ep.docVersion})${RESET}` : '';

    lines.push(`  ${BOLD}${i + 1}.${RESET} ${methodBadge} ${BOLD}${CYAN}${ep.path}${RESET}${depBadge}${verBadge}`);
    if (ep.summary) {
      lines.push(`     ${BOLD}${ep.summary}${RESET}`);
    }
    if (ep.description && ep.description !== ep.summary) {
      lines.push(`     ${DIM}${ep.description.slice(0, 120)}${ep.description.length > 120 ? '...' : ''}${RESET}`);
    }

    if (ep.parameters.length > 0) {
      const paramStr = ep.parameters.map(p => {
        const req = p.required ? `${RED}*${RESET}` : '';
        return `${p.name}${req} (${p.in}:${p.type || 'any'})`;
      }).join(', ');
      lines.push(`     ${DIM}Params: ${paramStr}${RESET}`);
    }

    if (ep.auth.length > 0) {
      const authStr = ep.auth.map(a => `${a.type}${a.scheme ? `:${a.scheme}` : ''}`).join(', ');
      lines.push(`     ${DIM}Auth: ${authStr}${RESET}`);
    }

    if (ep.pagination) {
      lines.push(`     ${DIM}Pagination: ${ep.pagination.type} (${ep.pagination.parameters.join(', ')})${RESET}`);
    }

    if (ep.errors.length > 0) {
      const errorCodes = ep.errors.map(e => e.statusCode).join(', ');
      lines.push(`     ${DIM}Error Codes: ${errorCodes}${RESET}`);
    }

    if (ep.provenance?.sourceUrl) {
      lines.push(`     ${DIM}Source: ${ep.provenance.sourceUrl}${RESET}`);
    }
    lines.push('');
  }

  lines.push(`${DIM}${'═'.repeat(64)}${RESET}`);
  lines.push('');
  return lines.join('\n');
}

export function formatIndexedExamples(
  examples: IndexedExample[],
  task?: string
): string {
  const lines: string[] = [];

  lines.push('');
  lines.push(`${BOLD}${CYAN}DocOrbit${RESET} ${DIM}— Code Example Intelligence for: "${task || '*'}"${RESET}`);
  lines.push(`${DIM}${'═'.repeat(64)}${RESET}`);

  if (examples.length === 0) {
    lines.push(`  ${YELLOW}No matching code examples found.${RESET}`);
    lines.push(`${DIM}${'═'.repeat(64)}${RESET}`);
    lines.push('');
    return lines.join('\n');
  }

  for (let i = 0; i < examples.length; i++) {
    const ex = examples[i];
    const fwBadge = ex.framework ? ` ${MAGENTA}[${ex.framework}]${RESET}` : '';
    const langBadge = `${GREEN}[${ex.language}]${RESET}`;
    const verBadge = ex.docVersion ? ` ${DIM}(${ex.docVersion})${RESET}` : '';
    const authBadge = ex.sourceAuthority === 'official' ? `${BLUE}[official]${RESET}` : `${DIM}[community]${RESET}`;

    lines.push(`  ${BOLD}${i + 1}.${RESET} ${CYAN}${ex.task}${RESET} ${langBadge}${fwBadge} ${authBadge}${verBadge}`);
    if (ex.relatedApi) {
      lines.push(`     ${BOLD}Target API:${RESET} ${BLUE}${ex.relatedApi}${RESET}`);
    }
    if (ex.relatedSymbol) {
      lines.push(`     ${BOLD}Symbol:${RESET} ${MAGENTA}${ex.relatedSymbol}${RESET}`);
    }

    lines.push(`     ${DIM}┌── code snippet ──────────────────────────${RESET}`);
    const codeLines = ex.code.split('\n').slice(0, 15);
    for (const cl of codeLines) {
      lines.push(`     ${DIM}│${RESET} ${cl}`);
    }
    if (ex.code.split('\n').length > 15) {
      lines.push(`     ${DIM}│ ... (${ex.code.split('\n').length - 15} more lines)${RESET}`);
    }
    lines.push(`     ${DIM}└──────────────────────────────────────────${RESET}`);
    lines.push(`     ${DIM}Source: ${ex.sourceUrl}${RESET}`);
    lines.push('');
  }

  lines.push(`${DIM}${'═'.repeat(64)}${RESET}`);
  lines.push('');
  return lines.join('\n');
}

export function formatPitfalls(
  pitfalls: Pitfall[],
  task?: string
): string {
  const lines: string[] = [];

  lines.push('');
  lines.push(`${BOLD}${YELLOW}DocOrbit${RESET} ${DIM}— Pitfalls & Warnings for: "${task || '*'}"${RESET}`);
  lines.push(`${DIM}${'═'.repeat(64)}${RESET}`);

  if (pitfalls.length === 0) {
    lines.push(`  ${GREEN}No matching pitfalls or warnings found.${RESET}`);
    lines.push(`${DIM}${'═'.repeat(64)}${RESET}`);
    lines.push('');
    return lines.join('\n');
  }

  for (let i = 0; i < pitfalls.length; i++) {
    const pf = pitfalls[i];
    let badgeColor = YELLOW;
    if (pf.kind === 'breaking_change' || pf.kind === 'removed' || pf.kind === 'security') {
      badgeColor = RED;
    } else if (pf.kind === 'deprecated') {
      badgeColor = MAGENTA;
    }

    const kindBadge = `${badgeColor}${BOLD}[${pf.kind.toUpperCase().replace(/_/g, ' ')}]${RESET}`;
    const verBadge = pf.docVersion ? ` ${DIM}(${pf.docVersion})${RESET}` : '';

    lines.push(`  ${BOLD}${i + 1}.${RESET} ${kindBadge} ${BOLD}${pf.title}${RESET}${verBadge}`);
    if (pf.relatedApi) {
      lines.push(`     ${DIM}Related API: ${BLUE}${pf.relatedApi}${RESET}`);
    }
    lines.push(`     ${DIM}│${RESET} ${pf.content}`);
    if (pf.provenance?.sourceUrl) {
      lines.push(`     ${DIM}Source: ${pf.provenance.sourceUrl}${RESET}`);
    }
    lines.push('');
  }

  lines.push(`${DIM}${'═'.repeat(64)}${RESET}`);
  lines.push('');
  return lines.join('\n');
}

export function formatRecipe(recipe: Recipe): string {
  const lines: string[] = [];

  const confidencePct = Math.round(recipe.confidence * 100);
  const confColor = confidencePct >= 70 ? GREEN : (confidencePct >= 40 ? YELLOW : RED);

  lines.push('');
  lines.push(`${BOLD}${GREEN}DocOrbit${RESET} ${DIM}— Implementation Recipe${RESET}`);
  lines.push(`${DIM}${'═'.repeat(64)}${RESET}`);
  lines.push(`${BOLD}Goal:${RESET}       ${CYAN}${recipe.goal}${RESET}`);
  lines.push(`${BOLD}Confidence:${RESET} ${confColor}${confidencePct}%${RESET}`);
  if (recipe.docVersion) {
    lines.push(`${BOLD}Version:${RESET}    ${MAGENTA}${recipe.docVersion}${RESET}`);
  }
  lines.push('');

  // Prerequisites
  lines.push(`${BOLD}Prerequisites (${recipe.prerequisites.length}):${RESET}`);
  lines.push(`${DIM}${'─'.repeat(64)}${RESET}`);
  if (recipe.prerequisites.length === 0) {
    lines.push(`  ${DIM}No special prerequisites documented.${RESET}`);
  } else {
    for (const pre of recipe.prerequisites) {
      const badge = pre.evidenceLevel === 'documented_fact'
        ? `${GREEN}[FACT]${RESET}`
        : `${YELLOW}[INFERRED]${RESET}`;
      lines.push(`  • ${badge} ${pre.text}`);
    }
  }
  lines.push('');

  // Ordered Implementation Steps
  lines.push(`${BOLD}Implementation Steps (${recipe.orderedSteps.length}):${RESET}`);
  lines.push(`${DIM}${'─'.repeat(64)}${RESET}`);
  for (const s of recipe.orderedSteps) {
    let badge = `${GREEN}[FACT]${RESET}`;
    if (s.evidenceLevel === 'inferred_relationship') badge = `${YELLOW}[INFERRED]${RESET}`;
    else if (s.evidenceLevel === 'missing_information') badge = `${RED}[MISSING]${RESET}`;

    lines.push(`  ${BOLD}${s.step}.${RESET} ${badge} ${BOLD}${CYAN}${s.title}${RESET}`);
    if (s.apiEndpoint) {
      lines.push(`     ${BOLD}API Endpoint:${RESET} ${BLUE}${s.apiEndpoint}${RESET}`);
    }
    lines.push(`     ${s.description}`);

    if (s.exampleCode) {
      lines.push(`     ${DIM}┌── example ────────────────────────────────${RESET}`);
      const codeLines = s.exampleCode.split('\n').slice(0, 10);
      for (const cl of codeLines) {
        lines.push(`     ${DIM}│${RESET} ${cl}`);
      }
      if (s.exampleCode.split('\n').length > 10) {
        lines.push(`     ${DIM}│ ... (${s.exampleCode.split('\n').length - 10} more lines)${RESET}`);
      }
      lines.push(`     ${DIM}└──────────────────────────────────────────${RESET}`);
    }

    if (s.pitfalls && s.pitfalls.length > 0) {
      for (const pf of s.pitfalls) {
        lines.push(`     ${YELLOW}⚠ ${pf}${RESET}`);
      }
    }
    if (s.sourceUrl) {
      lines.push(`     ${DIM}Source: ${s.sourceUrl}${RESET}`);
    }
    lines.push('');
  }

  // Evidence-Based Validation Steps
  lines.push(`${BOLD}Validation Steps (${recipe.validationSteps.length}):${RESET}`);
  lines.push(`${DIM}${'─'.repeat(64)}${RESET}`);
  for (const vs of recipe.validationSteps) {
    let badge = `${GREEN}[FACT]${RESET}`;
    if (vs.evidenceLevel === 'inferred_relationship') badge = `${YELLOW}[INFERRED]${RESET}`;
    else if (vs.evidenceLevel === 'missing_information') badge = `${RED}[MISSING]${RESET}`;

    lines.push(`  ${BOLD}${vs.step}.${RESET} ${badge} ${vs.description}`);
    if (vs.expectedResponse) {
      lines.push(`     ${DIM}Expected Response:${RESET} ${vs.expectedResponse.slice(0, 100)}`);
    }
    if (vs.testPattern) {
      lines.push(`     ${DIM}Test Pattern:${RESET} ${vs.testPattern.slice(0, 100)}`);
    }
  }
  lines.push('');

  // Sources consulted
  if (recipe.sources.length > 0) {
    lines.push(`${BOLD}Sources Consulted:${RESET}`);
    for (const src of recipe.sources) {
      lines.push(`  ${DIM}• ${src}${RESET}`);
    }
    lines.push('');
  }

  lines.push(`${DIM}${'═'.repeat(64)}${RESET}`);
  lines.push('');
  return lines.join('\n');
}
