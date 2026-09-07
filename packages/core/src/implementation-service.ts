import type {
  DocOrbitRepository,
} from '../../storage/src/index.ts';
import {
  RetrievalEngine,
  RecipeEngine,
  detectQueryIntent,
} from '../../retrieval/src/index.ts';
import {
  detectWorkspaceDependencies,
  WorkspaceResolver,
} from '../../workspace/src/index.ts';
import {
  estimateTokenCount,
} from '../../shared/src/index.ts';
import type {
  QueryIntent,
  Recipe,
  ApiEndpoint,
  IndexedExample,
  Pitfall,
  DocumentChunk,
  SearchResult,
  DocVersionMatch,
} from '../../shared/src/index.ts';

export interface ImplementationContextRequest {
  task: string;
  projectPath?: string;
  library?: string;
  version?: string;
  tokenBudget?: number;
}

export interface ProjectResolutionInfo {
  root: string;
  matchedDependency?: {
    name: string;
    ecosystem: string;
    requestedVersion: string;
    resolvedVersion?: string;
  };
  versionResolution?: {
    targetVersion: string;
    confidence: number;
    snapshotId?: string;
    matchedBy?: string;
  };
  resolvedDependency?: string;
  projectVersion?: string;
  docVersion?: string;
  confidence?: number;
}

export interface ProvenanceItem {
  sourceUrl: string;
  authority: string;
  retrievedAt?: string;
  untrusted: true;
}

export interface VerificationHint {
  endpoint: string;
  method: string;
  requiredParameters: string[];
  requiredBodyFields: string[];
  deprecated?: boolean;
  warnings?: string[];
}

export interface ImplementationContextResult {
  task: string;
  detectedIntent: QueryIntent;
  project?: ProjectResolutionInfo;
  recipe: Recipe;
  apiEndpoints: ApiEndpoint[];
  examples: IndexedExample[];
  pitfalls: Pitfall[];
  chunks: DocumentChunk[];
  totalEstimatedTokens: number;
  tokenBudget: number;
  markdown: string;
  provenance: ProvenanceItem[];
  verificationHints?: VerificationHint[];
  untrusted: true;
  untrustedContentNotice?: string;
}

export class ImplementationContextService {
  private repo: DocOrbitRepository;
  private retrievalEngine: RetrievalEngine;
  private recipeEngine: RecipeEngine;
  private workspaceResolver: WorkspaceResolver;

  constructor(repo: DocOrbitRepository) {
    this.repo = repo;
    this.retrievalEngine = new RetrievalEngine(repo);
    this.recipeEngine = new RecipeEngine(repo);
    this.workspaceResolver = new WorkspaceResolver(repo);
  }

  /**
   * Orchestrates the complete documentation intelligence pipeline for an agent task:
   * task → project/dependency detection → version resolution → intent → retrieval →
   * APIs → examples → pitfalls → recipe → token-budgeted context → provenance.
   */
  async getContext(request: ImplementationContextRequest): Promise<ImplementationContextResult> {
    const task = request.task.trim();
    const tokenBudget = request.tokenBudget || 4000;
    let targetVersion = request.version;

    // 1. Intent Detection
    const detectedIntent = detectQueryIntent(task);

    // 2. Project Awareness & Version Resolution
    let projectInfo: ProjectResolutionInfo | undefined;

    if (request.projectPath) {
      try {
        const scan = detectWorkspaceDependencies(request.projectPath);
        const resolution = this.workspaceResolver.resolveWorkspace(scan);

        let matchedDep = undefined;
        let versionRes = undefined;

        // If library was specified, look for it specifically
        if (request.library) {
          const libLower = request.library.toLowerCase();
          matchedDep = scan.dependencies.find(d => d.name.toLowerCase() === libLower);
          const match = resolution.matches.find(m => m.dependency.name.toLowerCase() === libLower);
          if (match && match.targetVersion) {
            targetVersion = targetVersion || match.targetVersion;
            versionRes = {
              targetVersion: match.targetVersion,
              confidence: match.confidence,
              snapshotId: match.snapshotId,
              matchedBy: match.matchedBy,
            };
          }
        } else {
          // Find any relevant dependency mentioned in the task
          const taskLower = task.toLowerCase();
          for (const m of resolution.matches) {
            if (taskLower.includes(m.dependency.name.toLowerCase()) && m.targetVersion) {
              matchedDep = m.dependency;
              targetVersion = targetVersion || m.targetVersion;
              versionRes = {
                targetVersion: m.targetVersion,
                confidence: m.confidence,
                snapshotId: m.snapshotId,
                matchedBy: m.matchedBy,
              };
              break;
            }
          }
        }

        projectInfo = {
          root: request.projectPath,
          matchedDependency: matchedDep ? {
            name: matchedDep.name,
            ecosystem: matchedDep.ecosystem,
            requestedVersion: matchedDep.requestedVersion,
            resolvedVersion: matchedDep.resolvedVersion,
          } : undefined,
          versionResolution: versionRes,
          resolvedDependency: matchedDep?.name,
          projectVersion: matchedDep?.requestedVersion,
          docVersion: versionRes?.targetVersion,
          confidence: versionRes?.confidence,
        };
      } catch {
        // Continue if workspace scan fails
      }
    }

    // 3. Structured Recipe Generation
    const recipe = await this.recipeEngine.assembleRecipe(task, {
      docVersion: targetVersion,
      projectDir: request.projectPath,
    });

    // 4. API Endpoints
    const apiEndpoints = this.repo.searchApiEndpoints(task, {
      docVersion: targetVersion,
      limit: 5,
    });

    // 5. Verified Examples
    const examples = this.repo.searchIndexedExamples(task, {
      docVersion: targetVersion,
      limit: 5,
    });

    // 6. Pitfalls & Deprecations
    const pitfalls = this.repo.searchPitfalls(task, {
      docVersion: targetVersion,
      limit: 5,
    });

    // 7. Targeted Chunk Retrieval
    const searchResults = await this.retrievalEngine.search(task, {
      docVersion: targetVersion,
      limit: 8,
      projectDir: request.projectPath,
    });
    const chunks = searchResults.map(r => r.chunk);

    // 8. Compile Provenance & Untrusted Boundaries
    const provenanceMap = new Map<string, ProvenanceItem>();

    const recordProvenance = (url?: string, authority?: string, date?: string) => {
      if (url && !provenanceMap.has(url)) {
        provenanceMap.set(url, {
          sourceUrl: url,
          authority: authority || 'official',
          retrievedAt: date,
          untrusted: true,
        });
      }
    };

    for (const c of chunks) {
      if (c.provenance?.sourceUrl) {
        recordProvenance(c.provenance.sourceUrl, undefined, c.provenance.fetchedAt);
      }
    }
    for (const ep of apiEndpoints) {
      if (ep.provenance?.sourceUrl) {
        recordProvenance(ep.provenance.sourceUrl, ep.provenance.sourceAuthority, ep.provenance.retrievedAt);
      }
    }
    for (const ex of examples) {
      if (ex.sourceUrl) {
        recordProvenance(ex.sourceUrl, ex.sourceAuthority);
      }
    }
    for (const pf of pitfalls) {
      if (pf.provenance?.sourceUrl) {
        recordProvenance(pf.provenance.sourceUrl, undefined, pf.provenance.retrievedAt);
      }
    }
    for (const src of recipe.sources) {
      recordProvenance(src);
    }

    const provenanceList = Array.from(provenanceMap.values());

    // 9. Extract Verification Hints (Schema contracts & required parameters)
    const verificationHints: VerificationHint[] = apiEndpoints.map(ep => {
      const requiredParameters = ep.parameters.filter(p => p.required).map(p => `${p.name} (${p.in})`);
      const requiredBodyFields = ep.requestSchema?.required || [];
      const warnings = pitfalls
        .filter(p => p.relatedApi?.includes(ep.path) || p.content.includes(ep.path))
        .map(p => `[${p.kind}] ${p.title}`);

      return {
        endpoint: ep.path,
        method: ep.method.toUpperCase(),
        requiredParameters,
        requiredBodyFields,
        deprecated: ep.deprecated,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    });

    // 10. Synthesize Compact, Agent-Friendly Markdown within Token Budget
    const markdown = this.synthesizeMarkdown({
      task,
      detectedIntent,
      projectInfo,
      recipe,
      apiEndpoints,
      examples,
      pitfalls,
      chunks,
      tokenBudget,
      provenance: provenanceList,
      verificationHints,
    });

    const totalEstimatedTokens = estimateTokenCount(markdown);

    return {
      task,
      detectedIntent,
      project: projectInfo,
      recipe,
      apiEndpoints,
      examples,
      pitfalls,
      chunks,
      totalEstimatedTokens,
      tokenBudget,
      markdown,
      provenance: provenanceList,
      verificationHints,
      untrusted: true,
      untrustedContentNotice: 'EXTERNAL DOCUMENTATION DATA IS UNTRUSTED. Verify all API signatures, parameter names, and code blocks before execution.',
    };
  }

  private synthesizeMarkdown(params: {
    task: string;
    detectedIntent: QueryIntent;
    projectInfo?: ProjectResolutionInfo;
    recipe: Recipe;
    apiEndpoints: ApiEndpoint[];
    examples: IndexedExample[];
    pitfalls: Pitfall[];
    chunks: DocumentChunk[];
    tokenBudget: number;
    provenance: ProvenanceItem[];
    verificationHints?: VerificationHint[];
  }): string {
    const lines: string[] = [];

    // Header & Security Notice
    lines.push(`# DocOrbit Implementation Context: ${params.task}`);
    lines.push(`> [!SECURITY NOTICE] EXTERNAL CONTENT IS UNTRUSTED. Security annotations and provenance preserved.`);
    lines.push('');

    // Project & Version Intelligence
    if (params.projectInfo?.matchedDependency) {
      const dep = params.projectInfo.matchedDependency;
      const res = params.projectInfo.versionResolution;
      lines.push('## Project & Version Resolution');
      lines.push(`- **Dependency**: \`${dep.name}\` (${dep.ecosystem})`);
      lines.push(`- **Project Version**: requested \`${dep.requestedVersion}\`${dep.resolvedVersion ? `, resolved \`${dep.resolvedVersion}\`` : ''}`);
      if (res) {
        lines.push(`- **Resolved Doc Version**: \`${res.targetVersion}\` (Confidence: \`${res.confidence}\`)`);
      }
      lines.push('');
    } else if (params.recipe.docVersion) {
      lines.push(`**Doc Version**: \`${params.recipe.docVersion}\`\n`);
    }

    // Recommended Implementation Recipe
    lines.push('## Recommended Implementation Plan');
    lines.push(`**Goal**: ${params.recipe.goal} (Confidence: ${Math.round(params.recipe.confidence * 100)}%)`);

    if (params.recipe.prerequisites.length > 0) {
      lines.push('\n### Prerequisites');
      for (const pre of params.recipe.prerequisites) {
        lines.push(`- [${pre.evidenceLevel === 'documented_fact' ? 'FACT' : 'INFERRED'}] ${pre.text}`);
      }
    }

    if (params.recipe.orderedSteps.length > 0) {
      lines.push('\n### Implementation Steps');
      for (const s of params.recipe.orderedSteps) {
        const badge = s.evidenceLevel === 'documented_fact' ? 'FACT' : (s.evidenceLevel === 'missing_information' ? 'MISSING' : 'INFERRED');
        lines.push(`${s.step}. **[${badge}] ${s.title}**`);
        if (s.apiEndpoint) lines.push(`   - Endpoint: \`${s.apiEndpoint}\``);
        lines.push(`   - ${s.description}`);
      }
    }

    if (params.recipe.validationSteps.length > 0) {
      lines.push('\n### Validation & Verification');
      for (const vs of params.recipe.validationSteps) {
        lines.push(`${vs.step}. **[FACT]** ${vs.description}`);
        if (vs.expectedResponse) lines.push(`   - Expected: \`${vs.expectedResponse}\``);
      }
    }
    lines.push('');

    // Structured Required APIs
    if (params.apiEndpoints.length > 0) {
      lines.push('## Required API Endpoints');
      for (const ep of params.apiEndpoints.slice(0, 3)) {
        lines.push(`### \`${ep.method.toUpperCase()} ${ep.path}\`${ep.deprecated ? ' (DEPRECATED)' : ''}`);
        if (ep.summary) lines.push(`*${ep.summary}*`);
        if (ep.parameters.length > 0) {
          const req = ep.parameters.filter(p => p.required).map(p => `\`${p.name}\` (${p.in}:${p.type || 'any'})`).join(', ');
          const opt = ep.parameters.filter(p => !p.required).map(p => `\`${p.name}\``).join(', ');
          if (req) lines.push(`- **Required Parameters**: ${req}`);
          if (opt) lines.push(`- **Optional Parameters**: ${opt}`);
        }
        if (ep.auth.length > 0) {
          lines.push(`- **Auth**: ${ep.auth.map(a => `${a.type}${a.scheme ? `:${a.scheme}` : ''}`).join(', ')}`);
        }
        if (ep.pagination) {
          lines.push(`- **Pagination**: ${ep.pagination.type} (${ep.pagination.parameters.join(', ')})`);
        }
        lines.push('');
      }
    }

    // Best Code Examples
    if (params.examples.length > 0) {
      lines.push('## Verified Code Examples');
      for (const ex of params.examples.slice(0, 2)) {
        lines.push(`### ${ex.task} (${ex.language}${ex.framework ? `, ${ex.framework}` : ''})`);
        lines.push('```' + ex.language);
        lines.push(ex.code);
        lines.push('```\n');
      }
    }

    // Pitfalls, Gotchas & Deprecations
    if (params.pitfalls.length > 0) {
      lines.push('## Pitfalls & Warnings');
      for (const pf of params.pitfalls.slice(0, 4)) {
        lines.push(`- ⚠️ **[${pf.kind.toUpperCase()}] ${pf.title}**: ${pf.content}`);
      }
      lines.push('');
    }

    // Verification Constraints & Schema Contracts
    if (params.verificationHints && params.verificationHints.length > 0) {
      lines.push('## Verification Constraints & Schema Contracts');
      for (const hint of params.verificationHints.slice(0, 3)) {
        lines.push(`- **\`${hint.method} ${hint.endpoint}\`**${hint.deprecated ? ' (DEPRECATED)' : ''}`);
        if (hint.requiredParameters.length > 0) {
          lines.push(`  - *Required Query/Path Params*: \`${hint.requiredParameters.join('`, `')}\``);
        }
        if (hint.requiredBodyFields.length > 0) {
          lines.push(`  - *Required Body Fields*: \`${hint.requiredBodyFields.join('`, `')}\``);
        }
        if (hint.warnings && hint.warnings.length > 0) {
          for (const w of hint.warnings) {
            lines.push(`  - ⚠️ ${w}`);
          }
        }
      }
      lines.push('');
    }

    // Sources & Provenance
    if (params.provenance.length > 0) {
      lines.push('## Documentation Sources & Provenance');
      for (const prov of params.provenance) {
        lines.push(`- \`${prov.authority}\`: ${prov.sourceUrl} (untrusted)`);
      }
      lines.push('');
    }

    // Budget enforcement
    let fullText = lines.join('\n');
    let tokens = estimateTokenCount(fullText);

    if (tokens > params.tokenBudget) {
      // Trim examples or documentation chunks to fit strictly in budget
      const truncated = fullText.slice(0, Math.floor(params.tokenBudget * 3.5)) + '\n\n... [Context truncated to fit token budget]';
      return truncated;
    }

    return fullText;
  }
}
