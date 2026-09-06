import type { SecurityAnnotation } from '../../shared/src/index.ts';

const MULTILINE_INJECTION_PATTERNS = [
  { pattern: /<system\b[^>]*>([\s\S]*?)<\/system>/gi, severity: 'high' as const, label: '<system> block' },
  { pattern: /\[SYSTEM(?:\s+INSTRUCTION)?\]([\s\S]*?)\[\/SYSTEM(?:\s+INSTRUCTION)?\]/gi, severity: 'high' as const, label: '[SYSTEM] block' },
  { pattern: /<\|im_start\|>system([\s\S]*?)<\|im_end\|>/gi, severity: 'high' as const, label: 'ChatML system block' },
  { pattern: /<!--\s*AI\s+INSTRUCTION:([\s\S]*?)-->/gi, severity: 'high' as const, label: 'HTML comment injection' },
];

const PROMPT_INJECTION_PATTERNS = [
  { pattern: /\b(?:ignore|disregard|forget)\s+(?:all\s+)?(?:previous|prior|above)\s+instructions\b/i, severity: 'high' as const },
  { pattern: /\b(?:system\s+message|system\s+prompt|system\s+instruction)\s*[:=]/i, severity: 'high' as const },
  { pattern: /\byou\s+are\s+now\s+(?:an?\s+)?(?:unrestricted|jailbroken|developer\s+mode|dan|evil)\b/i, severity: 'high' as const },
  { pattern: /\byou\s+are\s+now\s+(?:acting\s+as\s+)?a\b.*?\bassistant\s+that\s+(?:executes|runs|ignores)\b/i, severity: 'high' as const },
  { pattern: /\bIMPORTANT\s+INSTRUCTION\s+FOR\s+(?:THE\s+)?AI\s+AGENT\b/i, severity: 'high' as const },
  { pattern: /\b(?:call|invoke|execute)\s+(?:the\s+)?tool\s+['"]?[a-zA-Z0-9_-]+['"]?\s+with\b/i, severity: 'high' as const },
  { pattern: /\buse\s+(?:the\s+)?(?:bash|terminal|shell|command|run_command)\s+tool\s+to\b/i, severity: 'high' as const },
  { pattern: /\bdo\s+not\s+tell\s+the\s+user\b/i, severity: 'medium' as const },
];

const SUSPICIOUS_INSTRUCTION_PATTERNS = [
  { pattern: /curl\s+-[sS]*[fF]*[kK]*\s+https?:\/\/[^\s|]+\s*\|\s*(?:ba)?sh/i, severity: 'high' as const },
  { pattern: /wget\s+-[qO-]*\s+https?:\/\/[^\s|]+\s*\|\s*(?:ba)?sh/i, severity: 'high' as const },
  { pattern: /powershell\s+.*-(?:enc|encodedcommand)\s+[A-Za-z0-9+/=]{20,}/i, severity: 'high' as const },
  { pattern: /base64\s+-d\s+.*\|\s*(?:ba)?sh/i, severity: 'high' as const },
  { pattern: /eval\s*\(\s*base64_decode\s*\(/i, severity: 'high' as const },
  { pattern: /\b(?:cat|type)\s+[^\n]*\.(?:ssh\/id_[a-zA-Z0-9_-]*|aws\/credentials|env)\b/i, severity: 'high' as const },
  { pattern: /\b(?:curl|wget|fetch|nc|ncat)\b[^\n]*\b(?:\.ssh\/id_|\.aws\/credentials|\.env|API_KEY|SECRET)\b/i, severity: 'high' as const },
  { pattern: /\b(?:printenv|env)\b[^\n]*\|\s*(?:curl|nc|wget|base64)/i, severity: 'high' as const },
];

const UNSAFE_LINK_PATTERNS = [
  { pattern: /\[[^\]]*\]\(((?:javascript|data|file):[\s\S]*?)\)(?:\.|\s|$)/i, severity: 'high' as const },
];

/**
 * Scans documentation content for security hazards (prompt injection,
 * malicious execution snippets, unsafe links, credential harvesting) and returns
 * non-destructive annotations.
 *
 * Principle: External documentation is treated as untrusted data and structurally
 * separated from agent instructions. Original documentation text is never altered.
 */
export function detectSecurityAnnotations(content: string): SecurityAnnotation[] {
  const annotations: SecurityAnnotation[] = [];
  if (!content) return annotations;

  // 1. Multiline patterns across whole content
  for (const rule of MULTILINE_INJECTION_PATTERNS) {
    let match: RegExpExecArray | null;
    const regex = new RegExp(rule.pattern.source, rule.pattern.flags);
    while ((match = regex.exec(content)) !== null) {
      const matchStart = match.index;
      const lineNumber = content.slice(0, matchStart).split('\n').length;
      annotations.push({
        type: 'prompt_injection_suspected',
        location: `Line ${lineNumber} (${rule.label})`,
        evidence: match[0].slice(0, 150).trim(),
        severity: rule.severity,
      });
    }
  }

  // 2. Line-by-line checks
  const lines = content.split('\n');

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    const loc = `Line ${lineIdx + 1}`;

    // Prompt injection checks
    for (const rule of PROMPT_INJECTION_PATTERNS) {
      const match = line.match(rule.pattern);
      if (match) {
        annotations.push({
          type: 'prompt_injection_suspected',
          location: loc,
          evidence: match[0].trim(),
          severity: rule.severity,
        });
      }
    }

    // Suspicious shell execution / credential theft checks
    for (const rule of SUSPICIOUS_INSTRUCTION_PATTERNS) {
      const match = line.match(rule.pattern);
      if (match) {
        annotations.push({
          type: 'suspicious_instruction',
          location: loc,
          evidence: match[0].trim(),
          severity: rule.severity,
        });
      }
    }

    // Unsafe link protocols check
    for (const rule of UNSAFE_LINK_PATTERNS) {
      const match = line.match(rule.pattern);
      if (match) {
        annotations.push({
          type: 'unsafe_link',
          location: loc,
          evidence: match[1] || match[0],
          severity: rule.severity,
        });
      }
    }
  }

  return annotations;
}
