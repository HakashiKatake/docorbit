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
  pageType?: PageType;
  parentUrl?: string;
  category?: string;
  breadcrumb?: string[];
  depth?: number;
  discoveryMethod?: string;
  documentationType?: string;
  framework?: string;
  docVersion?: string;
}

export type PageType =
  | 'documentation_overview'
  | 'guide'
  | 'tutorial'
  | 'api_reference'
  | 'endpoint'
  | 'authentication'
  | 'webhook'
  | 'schema'
  | 'concept'
  | 'troubleshooting'
  | 'faq'
  | 'changelog'
  | 'release_notes'
  | 'other_documentation';

export type LinkPriority =
  | 'nav_sidebar'
  | 'breadcrumb'
  | 'category'
  | 'body'
  | 'prev_next'
  | 'related'
  | 'footer'
  | 'unknown';

export interface DocumentationSiteDetection {
  isDocumentation: boolean;
  confidence: number; // 0.0 to 1.0
  explanation: string;
  framework?: string;
  documentationType?: 'api_reference' | 'guide' | 'general' | 'sdk';
  docVersion?: string;
  signals: {
    hasDocTitle: boolean;
    hasNavOrSidebar: boolean;
    hasBreadcrumbs: boolean;
    hasApiTerminology: boolean;
    hasCodeBlocks: boolean;
    hasEndpointPatterns: boolean;
    hasDocsFramework: boolean;
    hasDocUrlPattern: boolean;
    internalDocLinkDensity: number;
  };
}

export interface DocumentationTreeNode {
  url: string;
  title: string;
  parentUrl?: string;
  category?: string;
  breadcrumb: string[];
  depth: number;
  pageType?: PageType;
  priority: LinkPriority;
  discoveryMethod: string;
  authority?: SourceAuthority;
  framework?: string;
  docVersion?: string;
  children: DocumentationTreeNode[];
}

export interface ExtractedDocLink {
  url: string;
  text: string;
  priority: LinkPriority;
  parentUrl?: string;
  category?: string;
  breadcrumb?: string[];
  discoveryMethod: string;
  isCollapsed?: boolean;
}

export interface FetchedDocPage {
  url: string;
  finalUrl: string;
  body: string;
  contentType: string;
  bytesRead: number;
  status: number;
  depth: number;
  parentUrl?: string;
  category?: string;
  breadcrumb?: string[];
  discoveryMethod: string;
  isCollapsed?: boolean;
}

export interface DiscoveredDocTreeResult {
  rootUrl: string;
  candidateUrl: string;
  siteDetection: DocumentationSiteDetection;
  tree: DocumentationTreeNode;
  pagesDiscovered: number;
  pagesIndexed: number;
  pagesSkipped: Array<{ url: string; reason: string }>;
  failedUrls: Array<{ url: string; error: string }>;
  duplicateUrls: string[];
  fetchedPages?: FetchedDocPage[];
  crawlLimits: {
    maxPages: number;
    maxDepth: number;
    maxBytes: number;
    timeoutMs: number;
  };
  bounded: boolean;
  boundedReason?: string;
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

// --- Milestone 2: Semantic Slicing & Retrieval Models ---

export type ChunkType = 'prose' | 'code' | 'api' | 'warning' | 'example' | 'mixed';

export interface DocumentChunk {
  id: string;
  pageId: string;
  snapshotId: string;
  title?: string;
  sectionPath: string[]; // Heading hierarchy breadcrumbs e.g. ['Authentication', 'OAuth 2.0', 'Tokens']
  content: string;
  chunkType: ChunkType;
  language?: string;
  tokenEstimate: number; // Heuristic estimate
  ordinal: number;
  contentHash: string;
  provenance: Provenance;
  docVersion?: string; // Optional version tag (e.g. 'v14', '14.2', 'latest')
}


export interface ChunkCode {
  id: string;
  chunkId: string;
  language?: string;
  code: string;
}

export type SymbolKind = 'function' | 'class' | 'interface' | 'endpoint' | 'type' | 'variable' | 'config';

export interface SymbolReference {
  id: string;
  chunkId: string;
  name: string;
  kind: SymbolKind;
}

export type ChunkRelationshipType =
  | 'parent_section'
  | 'next_chunk'
  | 'previous_chunk'
  | 'contains_code'
  | 'explains_code';

export interface ChunkRelationship {
  sourceChunkId: string;
  targetChunkId: string;
  type: ChunkRelationshipType;
}

export interface ChunkingConfig {
  targetTokens: number;
  maxTokens: number;
  overlapTokens: number;
}

export type QueryIntent =
  | 'api'
  | 'examples'
  | 'implementation'
  | 'conceptual'
  | 'troubleshooting'
  | 'configuration';

export interface ScoringWeights {
  version: string;
  bm25Weight: number;
  exactPhraseBonus: number;
  titleBonus: number;
  sectionPathBonus: number;
  symbolMatchBonus: number;
  intentTypeBonus: number;
  versionBonus: number; // Bonus when chunk version matches project dependency version
  authorityWeights: Record<SourceAuthority, number>;
}

export interface SearchResult {
  chunk: DocumentChunk;
  score: number;
  matchReasons: string[];
  symbols: SymbolReference[];
  codeSnippets: ChunkCode[];
}

export interface SearchOptions {
  limit?: number;
  chunkType?: ChunkType;
  snapshotId?: string;
  sourceId?: string;
  minScore?: number;
  intent?: QueryIntent;
  weights?: Partial<ScoringWeights>;
  docVersion?: string; // Filter/boost by documentation version (e.g. 'v14')
  projectDir?: string; // Path to project workspace to resolve dependencies automatically
}

export interface ContextPackage {
  task: string;
  detectedIntent: QueryIntent;
  totalEstimatedTokens: number;
  tokenBudget: number;
  chunks: DocumentChunk[];
  markdown: string;
  sources: string[];
  warnings: string[];
  resolvedVersions?: Record<string, VersionResolutionResult>;
}

export interface ContextOptions {
  tokenBudget?: number; // Target token budget (default 3000)
  maxChunks?: number;
  intent?: QueryIntent;
  weights?: Partial<ScoringWeights>;
  redundancyPenalty?: number; // 0.0 to 1.0 penalty for chunks covering identical sections
  snapshotId?: string;
  docVersion?: string; // Target documentation version
  projectDir?: string; // Path to project workspace
}

// --- Milestone 3: Version Intelligence & Project Awareness ---

export type Ecosystem =
  | 'npm'
  | 'cargo'
  | 'go'
  | 'pypi'
  | 'maven'
  | 'rubygems'
  | 'composer'
  | 'pub';

export interface ProjectDependency {
  name: string;
  ecosystem: Ecosystem;
  requestedVersion: string;
  resolvedVersion?: string;
  sourceFile: string;
  packagePath?: string;
  isDev?: boolean;
}

export interface WorkspaceScanResult {
  workspaceRoot: string;
  ecosystems: Ecosystem[];
  manifestsFound: string[];
  dependencies: ProjectDependency[];
}

export type DocVersionMatch =
  | 'exact'
  | 'major_minor'
  | 'major'
  | 'range'
  | 'latest_fallback'
  | 'unresolved';

export interface VersionResolutionResult {
  dependencyName: string;
  projectVersion: string;
  selectedDocVersion: string;
  matchType: DocVersionMatch;
  confidence: number;
  availableVersions: string[];
}

export interface LockedDoc {
  name: string;
  ecosystem: Ecosystem;
  requestedVersion: string;
  resolvedDependencyVersion: string;
  sourceFile: string;
  docSourceUrl: string;
  docVersion: string;
  matchType: DocVersionMatch;
  confidence: number;
  snapshotId: string;
  snapshotHash: string;
  retrievedAt: string;
  metadata?: Record<string, unknown>;
}

export interface DocsLock {
  version: 1;
  workspaceRoot: string;
  dependencies: Record<string, LockedDoc>;
}

// --- Milestone 4: Structured Implementation Knowledge ---

export type EvidenceLevel =
  | 'documented_fact'
  | 'inferred_relationship'
  | 'missing_information';

export interface ApiParameter {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required: boolean;
  type?: string;
  description?: string;
  default?: unknown;
  schema?: Record<string, unknown>;
  example?: unknown;
}

export interface ApiSchema {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  description?: string;
  items?: Record<string, unknown>;
  raw?: Record<string, unknown>;
}

export interface ApiResponse {
  statusCode: string; // e.g. '200', '201', '400', 'default'
  description: string;
  contentType?: string;
  schema?: ApiSchema;
  example?: unknown;
}

export interface ApiAuthScheme {
  type: 'apiKey' | 'http' | 'oauth2' | 'openIdConnect' | 'mutualTLS';
  name?: string;
  in?: 'header' | 'query' | 'cookie';
  scheme?: string; // e.g. 'bearer', 'basic'
  bearerFormat?: string; // e.g. 'JWT'
  description?: string;
}

export interface ApiErrorResponse {
  statusCode: string;
  description: string;
  schema?: ApiSchema;
  example?: unknown;
}

export interface ApiPaginationMetadata {
  type: 'cursor' | 'offset' | 'page' | 'link_header' | 'unknown';
  parameters: string[]; // e.g. ['starting_after', 'limit']
  responseFields: string[]; // e.g. ['has_more', 'data']
}

export interface ApiEndpoint {
  id: string;
  pageId: string;
  snapshotId: string;
  method: 'get' | 'post' | 'put' | 'delete' | 'patch' | 'head' | 'options';
  path: string;
  summary?: string;
  description?: string;
  operationId?: string;
  parameters: ApiParameter[];
  requestSchema?: ApiSchema;
  responseSchema?: Record<string, ApiResponse>;
  auth: ApiAuthScheme[];
  errors: ApiErrorResponse[];
  pagination?: ApiPaginationMetadata;
  deprecated: boolean;
  docVersion?: string;
  provenance?: Provenance;
  createdAt: string;
}

export interface IndexedExample {
  id: string;
  chunkId?: string;
  pageId: string;
  snapshotId: string;
  language: string;
  framework?: string;
  task: string;
  code: string;
  sourceUrl: string;
  sourceAuthority: SourceAuthority;
  relatedApi?: string; // e.g. 'POST /v1/webhook_endpoints'
  relatedSymbol?: string; // e.g. 'constructEvent'
  docVersion?: string;
  provenance?: Provenance;
  createdAt: string;
}

export type PitfallKind =
  | 'deprecated'
  | 'removed'
  | 'breaking_change'
  | 'server_only'
  | 'client_only'
  | 'required_config'
  | 'permission'
  | 'rate_limit'
  | 'runtime_restriction'
  | 'security';

export interface Pitfall {
  id: string;
  chunkId?: string;
  pageId: string;
  snapshotId: string;
  kind: PitfallKind;
  title: string;
  content: string;
  relatedApi?: string;
  relatedSymbol?: string;
  docVersion?: string;
  provenance?: Provenance;
  createdAt: string;
}

export interface RecipeStep {
  step: number;
  title: string;
  description: string;
  evidenceLevel: EvidenceLevel;
  apiEndpoint?: string; // e.g. 'POST /v1/subscriptions'
  exampleCode?: string;
  pitfalls?: string[];
  sourceUrl?: string;
  sourceChunkIds?: string[];
}

export interface RecipeValidationStep {
  step: number;
  description: string;
  evidenceLevel: EvidenceLevel;
  expectedResponse?: string;
  testPattern?: string;
  sourceUrl?: string;
}

export interface Recipe {
  id: string;
  goal: string;
  prerequisites: Array<{ text: string; evidenceLevel: EvidenceLevel; sourceUrl?: string }>;
  orderedSteps: RecipeStep[];
  requiredApis: string[];
  examples: string[];
  pitfalls: string[];
  validationSteps: RecipeValidationStep[];
  sources: string[];
  docVersion?: string;
  confidence: number;
}

export interface ApiCommandOptions {
  method?: string;
  docVersion?: string;
  projectDir?: string;
  limit?: number;
  json?: boolean;
  dbPath?: string;
  global?: boolean;
  project?: boolean;
}

export interface ExamplesCommandOptions {
  language?: string;
  framework?: string;
  docVersion?: string;
  projectDir?: string;
  limit?: number;
  json?: boolean;
  dbPath?: string;
  global?: boolean;
  project?: boolean;
}

export interface PitfallsCommandOptions {
  kind?: PitfallKind;
  docVersion?: string;
  projectDir?: string;
  limit?: number;
  json?: boolean;
  dbPath?: string;
  global?: boolean;
  project?: boolean;
}

export interface RecipesCommandOptions {
  docVersion?: string;
  projectDir?: string;
  json?: boolean;
  dbPath?: string;
  global?: boolean;
  project?: boolean;
}

// --- Milestone 6 Verification, Diff & Impact Types ---

export type VerificationRule =
  | 'endpoint_validity'
  | 'method_validity'
  | 'required_parameters'
  | 'schema_compatibility'
  | 'deprecation'
  | 'removed_api'
  | 'version_mismatch'
  | 'response_assumption';

export type VerificationSeverity = 'error' | 'warning' | 'info';

export type VerificationStatus =
  | 'verified'
  | 'warning'
  | 'mismatch'
  | 'insufficient_evidence';

export interface VerificationFinding {
  id: string;
  rule: VerificationRule;
  severity: VerificationSeverity;
  status: VerificationStatus;
  message: string;
  location?: {
    line?: number;
    column?: number;
    snippet?: string;
  };
  expected?: unknown;
  actual?: unknown;
  docVersion?: string;
  provenance?: {
    sourceUrl?: string;
    sourceAuthority?: string;
    endpointId?: string;
    pitfallId?: string;
  };
  confidence: number;
}

export interface ExtractedApiCall {
  endpointPath?: string;
  method?: string;
  parameters?: Record<string, unknown>;
  bodyFields?: string[];
  headers?: Record<string, string>;
  responseFieldsAccessed?: string[];
  symbol?: string;
  rawSnippet: string;
  line?: number;
  language?: string;
  isDynamicOrAmbiguous?: boolean;
  reasonIfAmbiguous?: string;
}

export interface VerificationResult {
  verdict: VerificationStatus;
  summary: string;
  targetVersion?: string;
  projectVersion?: string;
  matchedLibrary?: string;
  findings: VerificationFinding[];
  extractedCalls: ExtractedApiCall[];
  totalChecks: number;
  untrusted: true;
}

export interface EndpointDiffItem {
  path: string;
  method: string;
  changeType: 'added' | 'removed' | 'deprecated' | 'modified';
  changes?: string[];
  endpoint: ApiEndpoint;
  previousEndpoint?: ApiEndpoint;
}

export interface DocDiffResult {
  fromVersion?: string;
  toVersion?: string;
  fromSnapshotId?: string;
  toSnapshotId?: string;
  sourceId?: string;
  summary: {
    endpointsAdded: number;
    endpointsRemoved: number;
    endpointsModified: number;
    endpointsDeprecated: number;
    pitfallsAdded: number;
    pitfallsRemoved: number;
    contentChanged: number;
  };
  apiChanges: EndpointDiffItem[];
  pitfallChanges: Array<{
    changeType: 'added' | 'removed';
    pitfall: Pitfall;
  }>;
  contentChanges: Array<{
    title: string;
    changeType: 'added' | 'removed' | 'modified';
    summary: string;
  }>;
  retrievedAt: string;
}

export interface AffectedFileLocation {
  filePath: string;
  line: number;
  column?: number;
  snippet: string;
  reason: string;
  matchedPattern: string;
  changeCategory:
    | 'removed_api'
    | 'deprecated_api'
    | 'modified_parameters'
    | 'breaking_pitfall'
    | 'content_change';
  certainty: 'high' | 'medium' | 'heuristic';
  confidence: number;
  relatedChange: {
    endpoint?: string;
    symbol?: string;
    pitfallTitle?: string;
  };
}

export interface ImpactAnalysisResult {
  projectDir: string;
  fromVersion?: string;
  toVersion?: string;
  totalFilesScanned: number;
  affectedFilesCount: number;
  affectedLocations: AffectedFileLocation[];
  summary: string;
}

export interface VerifyCommandOptions {
  docVersion?: string;
  projectDir?: string;
  library?: string;
  language?: string;
  json?: boolean;
  dbPath?: string;
  global?: boolean;
  project?: boolean;
}

export interface DiffCommandOptions {
  from?: string;
  to?: string;
  source?: string;
  projectDir?: string;
  json?: boolean;
  dbPath?: string;
  global?: boolean;
  project?: boolean;
}

export interface ImpactCommandOptions {
  from?: string;
  to?: string;
  projectDir?: string;
  source?: string;
  json?: boolean;
  dbPath?: string;
  global?: boolean;
  project?: boolean;
}

// --- Milestone 7: Web Dashboard & Agent File Exports ---

export type ExportFormat =
  | 'agents.md'
  | 'claude.md'
  | 'skill.md'
  | 'llms.txt'
  | 'docs-map.md';

export interface ExportOptions {
  format: ExportFormat;
  projectDir?: string;
  targetSource?: string;
  docVersion?: string;
  outputPath?: string;
  stdout?: boolean;
  tokenBudget?: number;
  dbPath?: string;
  global?: boolean;
  project?: boolean;
}

export interface ExportResult {
  format: ExportFormat;
  content: string;
  outputPath?: string;
  metadata: {
    generatedAt: string;
    sources: string[];
    docVersion?: string;
    projectDependencies: Array<{ name: string; version: string; matchType: string }>;
    totalApis: number;
    totalPitfalls: number;
    totalExamples: number;
    tokenEstimate: number;
    untrusted: true;
  };
}

export interface DocumentationMapNode {
  id: string;
  title: string;
  url: string;
  version?: string;
  sourceId: string;
  chunkCount: number;
  estimatedTokens: number;
  headings: string[];
  apis?: string[];
  pitfallCount?: number;
  exampleCount?: number;
  untrusted: true;
}

export interface DocumentationMapResult {
  totalSources: number;
  totalPages: number;
  totalChunks: number;
  totalEstimatedTokens: number;
  sources: Array<{
    id: string;
    url: string;
    version?: string;
    pageCount: number;
    chunkCount: number;
  }>;
  pages: DocumentationMapNode[];
  markdownTree: string;
  untrusted: true;
}

export interface DashboardOptions {
  port?: number;
  host?: string;
  dbPath?: string;
  projectDir?: string;
  open?: boolean;
}

export interface DashboardStats {
  totalSources: number;
  totalPages: number;
  totalChunks: number;
  totalApis: number;
  totalPitfalls: number;
  totalExamples: number;
  totalRecipes: number;
  activeVersions: string[];
  dbPath: string;
  untrusted: true;
}

// --- Milestone 8 Evaluation & Benchmarking Types ---

export type AgentEvaluationStrategy =
  | 'agent_official_docs_fetch'
  | 'agent_context7'
  | 'agent_docorbit'
  | 'agent_firecrawl'
  | 'agent_web_search';

export type EvaluationSplit = 'train' | 'eval' | 'verification';

export interface BenchmarkTaskDoc {
  url: string;
  title: string;
  version: string;
  content: string;
}

export interface BenchmarkTaskDef {
  id: string;
  split: EvaluationSplit;
  title: string;
  ecosystem: string;
  library: string;
  targetVersion: string;
  taskPrompt: string;
  workspaceFiles: Record<string, string>;
  docs: BenchmarkTaskDoc[];
  /** Canonical documentation URL for the direct-docs-fetch web baseline */
  docsUrl: string;
  /** Optional pre-structured endpoints to index into DocOrbit for AST verification */
  endpoints?: ApiEndpoint[];
  /** Optional pre-structured pitfalls to index into DocOrbit for AST verification */
  pitfalls?: Pitfall[];
  /** Dedicated verification category if this is an intentional code flaw test */
  verificationCategory?:
    | 'wrong_endpoint'
    | 'wrong_http_method'
    | 'missing_required_parameter'
    | 'deprecated_api'
    | 'removed_api'
    | 'version_mismatch'
    | 'dynamic_ambiguous_code';
  groundTruth: {
    expectedVersion: string;
    expectedApi: { method?: string; path?: string; symbol?: string; requiredParams?: string[] };
    fatalPitfalls: string[];
    validCode: string;
    invalidCode: { snippet: string; expectedRule: string };
    dynamicCode?: string;
  };
}

export interface BenchmarkTaskResult {
  strategy: AgentEvaluationStrategy;
  taskId: string;
  split: EvaluationSplit;
  taskSuccess: boolean;
  correctApiSelected: boolean;
  correctVersionSelected: boolean;
  retrievalPrecision: number;
  retrievalRecall: number;
  tokenUsage: number;
  latencyMs: number;
  toolCallsCount: number;
  verificationCatches: number;
  verificationFalsePositives: number;
  insufficientEvidenceCount: number;
  notes: string;
  /** True when this result was produced by a simulated runner (no real network calls) */
  isSimulation: boolean;
  /** First 2000 chars of actual retrieved content for auditability; empty string for simulations */
  rawRetrievedContent: string;
}

export interface StrategyAggregateMetrics {
  overallSuccessRate: number;
  evalSuccessRate: number;
  versionAccuracy: number;
  meanPrecision: number;
  meanRecall: number;
  meanTokens: number;
  medianTokens: number;
  meanLatencyMs: number;
  meanToolCalls: number;
  totalVerificationCatches: number;
  verificationCatchRate?: number;
  falsePositives: number;
  insufficientEvidenceRate: number;
}

export interface BenchmarkSuiteReport {
  timestamp: string;
  totalTasks: number;
  trainTasks: number;
  evalTasks: number;
  verificationTasks?: number;
  byStrategy: Record<AgentEvaluationStrategy, StrategyAggregateMetrics>;
  tasks: BenchmarkTaskResult[];
}
