import type { QueryIntent } from '../../shared/src/index.ts';

const INTENT_PATTERNS: Array<{ intent: QueryIntent; regex: RegExp }> = [
  {
    intent: 'troubleshooting',
    regex: /\b(error|failed|failure|exception|crash|fix|debug|issue|cannot|unable|why does|broken|invalid|429|401|403|404|500)\b/i,
  },
  {
    intent: 'examples',
    regex: /\b(example|examples|sample|samples|snippet|snippets|tutorial|how to|quickstart)\b/i,
  },
  {
    intent: 'configuration',
    regex: /\b(config|configuration|settings|setup|env|\.env|environment|options|flags?|port|credentials|apikey|api_key)\b/i,
  },
  {
    intent: 'api',
    regex: /\b(api|endpoint|endpoints|parameters?|request|response|headers?|payload|schema|rest|graphql|status code)\b/i,
  },
  {
    intent: 'implementation',
    regex: /\b(implement|implementation|build|create|integrate|integration|workflow|handler|webhook|callback|oauth|pipeline)\b/i,
  },
  {
    intent: 'conceptual',
    regex: /\b(architecture|overview|what is|concept|concepts|design|lifecycle|philosophy|background|understand)\b/i,
  },
];


/**
 * Deterministically detects query intent from task or query text.
 * Falls back to 'conceptual' when no specific pattern matches.
 */
export function detectQueryIntent(query: string): QueryIntent {
  const normalized = query.toLowerCase();
  for (const { intent, regex } of INTENT_PATTERNS) {
    if (regex.test(normalized)) {
      return intent;
    }
  }
  return 'conceptual';
}
