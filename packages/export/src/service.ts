import fs from 'node:fs';
import path from 'node:path';
import type {
  DocOrbitRepository,
} from '../../storage/src/index.ts';
import { WorkspaceResolver } from '../../workspace/src/index.ts';
import { RecipeEngine } from '../../retrieval/src/index.ts';
import type {
  ExportFormat,
  ExportOptions,
  ExportResult,
  DocumentationMapResult,
  ProjectDependency,
  VersionResolutionResult,
  ApiEndpoint,
  Pitfall,
  Recipe,
  NormalizedPage,
  DiscoveredSource,
} from '../../shared/src/index.ts';
import { generateAgentsMd } from './agents-md.ts';
import { generateClaudeMd } from './claude-md.ts';
import { generateSkillMd } from './skill-md.ts';
import { generateLlmsTxt } from './llms-txt.ts';
import { buildDocumentationMap } from './docs-map.ts';

export class ExportService {
  private repo: DocOrbitRepository;
  private workspaceResolver: WorkspaceResolver;
  private recipeEngine: RecipeEngine;

  constructor(repo: DocOrbitRepository) {
    this.repo = repo;
    this.workspaceResolver = new WorkspaceResolver(repo);
    this.recipeEngine = new RecipeEngine(repo);
  }

  /**
   * Generates agent documentation export deterministically based on indexed evidence.
   */
  async generateExport(options: ExportOptions): Promise<ExportResult> {
    const projectDir = options.projectDir ? path.resolve(options.projectDir) : undefined;
    const docVersion = options.docVersion;

    // 1. Resolve workspace dependencies if project directory exists
    const dependencies: Array<{
      dep: ProjectDependency;
      resolution?: VersionResolutionResult;
    }> = [];

    if (projectDir && fs.existsSync(projectDir)) {
      try {
        const resolvedMap = await this.workspaceResolver.resolveAllDependencies(projectDir);
        for (const [, item] of resolvedMap) {
          dependencies.push({
            dep: item.dependency,
            resolution: item.resolution,
          });
        }
      } catch {
        // Workspace detection is best-effort
      }
    }

    // 2. Fetch indexed sources & pages
    const sources = this.repo.sources.listSources();
    const sourceUrls = sources.map(s => s.url);
    const pages = this.repo.pages.listPages(1000);

    // 3. Fetch endpoints (filtered by docVersion if provided)
    const endpoints = this.repo.apis.searchApiEndpoints('', {
      docVersion,
      limit: 200,
    });

    // 4. Fetch pitfalls (filtered by docVersion if provided)
    const pitfalls = this.repo.pitfalls.searchPitfalls('', {
      docVersion,
      limit: 100,
    });

    // 5. Fetch code examples
    const examples = this.repo.examples.searchIndexedExamples('', {
      docVersion,
      limit: 100,
    });

    // 6. Build recipes for common goals
    const recipes: Recipe[] = [];
    const candidateGoals = [
      'Stripe webhook signature verification',
      'Handle webhook events',
      'Create customer subscription',
      'Dynamic route parameter migration',
      'Authenticate API request',
    ];

    for (const goal of candidateGoals) {
      try {
        const recipe = this.recipeEngine.assembleRecipe(goal, { docVersion });
        if (recipe.prerequisites.length > 0 || recipe.steps.length > 0) {
          recipes.push(recipe);
        }
      } catch {
        // Goal not covered by current index
      }
    }

    // 7. Format generation
    let content = '';
    const format = options.format;

    switch (format) {
      case 'agents.md': {
        content = generateAgentsMd({
          projectDir,
          docVersion,
          dependencies,
          endpoints,
          pitfalls,
          recipes,
          sources: sourceUrls,
        });
        break;
      }
      case 'claude.md': {
        content = generateClaudeMd({
          projectDir,
          docVersion,
          dependencies,
          endpoints,
          pitfalls,
          sources: sourceUrls,
        });
        break;
      }
      case 'skill.md': {
        content = generateSkillMd({
          skillName: options.targetSource || 'docorbit-agent-skill',
          docVersion,
          endpoints,
          pitfalls,
          recipes,
          sources: sourceUrls,
        });
        break;
      }
      case 'llms.txt': {
        content = generateLlmsTxt({
          title: options.targetSource || 'Indexed Documentation',
          docVersion,
          pages,
          endpoints,
          pitfalls,
        });
        break;
      }
      case 'docs-map.md': {
        const map = buildDocumentationMap({
          sources,
          pages,
          endpoints,
          pitfalls,
          docVersion,
        });
        content = map.markdownTree;
        break;
      }
      default:
        throw new Error(`Unsupported export format: ${format}`);
    }

    const tokenEstimate = Math.ceil(content.length / 4);

    return {
      format,
      content,
      outputPath: options.outputPath,
      metadata: {
        generatedAt: '2026-09-06T00:00:00.000Z', // Deterministic baseline timestamp
        sources: sourceUrls,
        docVersion,
        projectDependencies: dependencies.map(d => ({
          name: d.dep.name,
          version: d.resolution?.targetVersion || d.dep.requestedVersion,
          matchType: d.resolution?.matchedBy || 'unresolved',
        })),
        totalApis: endpoints.length,
        totalPitfalls: pitfalls.length,
        totalExamples: examples.length,
        tokenEstimate,
        untrusted: true,
      },
    };
  }

  /**
   * Retrieves the structured documentation map.
   */
  getDocumentationMap(options: { sourceId?: string; docVersion?: string } = {}): DocumentationMapResult {
    let sources = this.repo.sources.listSources();
    if (options.sourceId) {
      sources = sources.filter(s => s.id === options.sourceId || s.url.includes(options.sourceId!));
    }

    const pages = this.repo.pages.listPages(1000);
    const endpoints = this.repo.apis.searchApiEndpoints('', { docVersion: options.docVersion, limit: 500 });
    const pitfalls = this.repo.pitfalls.searchPitfalls('', { docVersion: options.docVersion, limit: 200 });

    return buildDocumentationMap({
      sources,
      pages,
      endpoints,
      pitfalls,
      docVersion: options.docVersion,
    });
  }

  /**
   * Generates export and writes directly to workspace file.
   */
  async writeExport(options: ExportOptions): Promise<ExportResult> {
    const result = await this.generateExport(options);

    if (!options.stdout) {
      let targetFile = options.outputPath;
      if (!targetFile) {
        const baseDir = options.projectDir || process.cwd();
        const defaultNames: Record<ExportFormat, string> = {
          'agents.md': 'AGENTS.md',
          'claude.md': 'CLAUDE.md',
          'skill.md': 'skill.md',
          'llms.txt': 'llms.txt',
          'docs-map.md': 'docs-map.md',
        };
        targetFile = path.join(baseDir, defaultNames[options.format]);
      }

      const dir = path.dirname(targetFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(targetFile, result.content, 'utf-8');
      result.outputPath = targetFile;
    }

    return result;
  }
}
