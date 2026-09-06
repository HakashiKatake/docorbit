export type SourceType =
  | 'llms_txt'
  | 'llms_full_txt'
  | 'openapi'
  | 'markdown'
  | 'sitemap'
  | 'github'
  | 'skill'
  | 'web';

export type SourceAuthority = 'official' | 'community' | 'third_party';

export type SourceStatus = 'valid' | 'invalid' | 'unreachable';

export interface DiscoveredSource {
  url: string;
  type: SourceType;
  discoveredBy: string;
  status: SourceStatus;
  contentType?: string;
  confidence: number; // 0.0 to 1.0
  authority: SourceAuthority;
  machineReadable: boolean;
  metadata?: Record<string, unknown>;
}

export type SourcePurpose =
  | 'navigation'       // Site structure, link catalogs, sitemaps
  | 'conceptual'       // Guides, tutorials, architectural explanations
  | 'api'              // Structured schemas, endpoints, parameter constraints
  | 'examples'         // Working code blocks, implementation snippets
  | 'implementation';  // Task-oriented end-to-end workflows

export interface SourceRankResult {
  purpose: SourcePurpose;
  recommended: DiscoveredSource | null;
  ranked: DiscoveredSource[];
  rationale: string;
}

export interface Heading {
  level: number;
  text: string;
  anchor: string;
}

export interface Link {
  text: string;
  url: string;
  isExternal: boolean;
}

export interface CodeExample {
  id: string;
  language: string;
  code: string;
  caption?: string;
}

export interface SecurityAnnotation {
  type: 'prompt_injection_suspected' | 'unsafe_link' | 'suspicious_instruction';
  location?: string;
  evidence: string;
  severity: 'low' | 'medium' | 'high';
}

export interface Provenance {
  sourceUrl: string;
  targetUrl: string;
  fetchedAt: string;
  discoveredBy: string;
  contentHash: string;
  snapshotId?: string;
}

export interface NormalizedPage {
  id: string;
  sourceId: string;
  title: string;
  url: string;
  content: string; // Deterministic, sanitized Markdown
  headings: Heading[];
  links: Link[];
  codeExamples: CodeExample[];
  contentHash: string; // SHA-256 of normalized content
  fetchedAt: string;
  rawBytes: number;
  estimatedTokens: number;
  securityAnnotations: SecurityAnnotation[];
  provenance?: Provenance;
}

export interface LlmsLink {
  title: string;
  url: string;
  description?: string;
}

export interface LlmsSection {
  name: string;
  links: LlmsLink[];
}

export interface LlmsDocument {
  title?: string;
  summary?: string;
  sections: LlmsSection[];
  rawContent: string;
}

export interface OpenApiSummary {
  specVersion: string;
  title: string;
  description?: string;
  servers: string[];
  pathCount: number;
  sourceUrl: string;
  rawJson?: Record<string, unknown>;
}

export interface CrawlerConfig {
  maxPages: number;
  maxDepth: number;
  maxBytesPerResponse: number;
  timeoutMs: number;
  maxRedirects: number;
  concurrency: number;
  allowedProtocols: string[];
  userAgent: string;
}

export interface Target {
  type: 'url' | 'library' | 'package' | 'git' | 'local';
  value: string;
  normalizedUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface CrawlPolicy {
  purpose?: SourcePurpose;
  maxPages: number;
  maxDepth: number;
  followLlmsReferences: boolean;
  followExternalDomains: boolean;
}
