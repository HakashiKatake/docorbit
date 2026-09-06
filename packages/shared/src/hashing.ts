import { createHash } from 'node:crypto';

export function computeSha256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

export function computeContentHash(content: string): string {
  // Normalize line endings and line-by-line trailing whitespace for canonical stability
  const normalized = content
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n')
    .trim();
  return computeSha256(normalized);
}

export function estimateTokenCount(text: string): number {
  // Heuristic: roughly ~4 characters per token for English and Markdown/code
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}
