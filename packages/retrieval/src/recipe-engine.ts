import { createHash } from 'node:crypto';
import type {
  Recipe,
  RecipeStep,
  RecipeValidationStep,
  EvidenceLevel,
  ApiEndpoint,
  IndexedExample,
  Pitfall,
} from '../../shared/src/index.ts';
import { DocOrbitRepository } from '../../storage/src/index.ts';
import { RetrievalEngine } from './engine.ts';
import { resolveProjectContext } from '../../workspace/src/index.ts';

export interface RecipeOptions {
  docVersion?: string;
  projectDir?: string;
}

export class RecipeEngine {
  private repository: DocOrbitRepository;
  private retrievalEngine: RetrievalEngine;

  constructor(repository: DocOrbitRepository, retrievalEngine?: RetrievalEngine) {
    this.repository = repository;
    this.retrievalEngine = retrievalEngine || new RetrievalEngine(repository);
  }

  /**
   * Deterministically compiles an implementation recipe grounded strictly in indexed evidence.
   * Distinguishes documented facts, inferred relationships, and missing information.
   * Never invents APIs, steps, prerequisites, or validation steps.
   */
  async assembleRecipe(goal: string, options: RecipeOptions = {}): Promise<Recipe> {
    const cleanGoal = goal.trim();
    let effectiveDocVersion = options.docVersion;

    // Resolve project and version context if projectDir is provided
    if (options.projectDir) {
      const projContext = resolveProjectContext(options.projectDir, cleanGoal, this.repository);
      if (projContext.matchedDependency && !effectiveDocVersion) {
        effectiveDocVersion = projContext.matchedDependency.targetDocVersion;
      }
    }

    // 1. Query candidate API endpoints, examples, pitfalls, and search chunks
    const endpoints = this.repository.searchApiEndpoints(cleanGoal, {
      docVersion: effectiveDocVersion,
      limit: 10,
    });

    const examples = this.repository.searchIndexedExamples(cleanGoal, {
      docVersion: effectiveDocVersion,
      limit: 10,
    });

    const pitfalls = this.repository.searchPitfalls(cleanGoal, {
      docVersion: effectiveDocVersion,
      limit: 10,
    });

    const searchResults = await this.retrievalEngine.search(cleanGoal, {
      docVersion: effectiveDocVersion,
      limit: 10,
    });

    // 2. Collect unique source URLs
    const sourcesSet = new Set<string>();
    for (const ep of endpoints) {
      if (ep.provenance?.sourceUrl) sourcesSet.add(ep.provenance.sourceUrl);
    }
    for (const ex of examples) {
      if (ex.sourceUrl) sourcesSet.add(ex.sourceUrl);
    }
    for (const pf of pitfalls) {
      if (pf.provenance?.sourceUrl) sourcesSet.add(pf.provenance.sourceUrl);
    }
    for (const sr of searchResults) {
      if (sr.chunk.provenance?.sourceUrl) sourcesSet.add(sr.chunk.provenance.sourceUrl);
    }
    const sources = Array.from(sourcesSet);

    // 3. Assemble Prerequisites strictly from documented requirements
    const prerequisites: Array<{ text: string; evidenceLevel: EvidenceLevel; sourceUrl?: string }> = [];

    // Check required_config or permission pitfalls
    for (const pf of pitfalls) {
      if (pf.kind === 'required_config' || pf.kind === 'permission') {
        prerequisites.push({
          text: `${pf.title}: ${pf.content}`,
          evidenceLevel: 'documented_fact',
          sourceUrl: pf.provenance?.sourceUrl,
        });
      }
    }

    // Check chunks with prerequisite/setup headings (only relevant chunks with score >= 5.0)
    for (const sr of searchResults.filter(s => s.score >= 5.0)) {
      const headingText = (sr.chunk.title || sr.chunk.sectionPath.join(' ')).toLowerCase();
      if (headingText.includes('prerequisite') || headingText.includes('before you begin') || headingText.includes('requirements')) {
        const textSnippet = sr.chunk.content.split('\n')[0].trim();
        if (textSnippet && !prerequisites.some(p => p.text === textSnippet)) {
          prerequisites.push({
            text: textSnippet,
            evidenceLevel: 'documented_fact',
            sourceUrl: sr.chunk.provenance?.sourceUrl,
          });
        }
      }
    }

    // 4. Assemble Ordered Steps
    const orderedSteps: RecipeStep[] = [];
    const usedApis = new Set<string>();
    const usedExamples = new Set<string>();
    const usedPitfalls = new Set<string>();
    let stepNumber = 1;

    // A. Setup / Client Initialization Step (if documented in examples)
    const initExample = examples.find(ex =>
      /(?:new\s+\w+|initialize|config(?:ure)?|createClient|express\(\)|FastAPI\()/i.test(ex.code)
    );
    if (initExample) {
      orderedSteps.push({
        step: stepNumber++,
        title: `Initialize Client / Service (${initExample.framework || initExample.language})`,
        description: `Configure and initialize client instance as documented in ${initExample.task}`,
        evidenceLevel: 'documented_fact',
        exampleCode: initExample.code,
        sourceUrl: initExample.sourceUrl,
        sourceChunkIds: initExample.chunkId ? [initExample.chunkId] : undefined,
      });
      usedExamples.add(initExample.id);
    }

    // B. Primary API Actions (Documented Fact)
    for (const ep of endpoints) {
      const apiStr = `${ep.method.toUpperCase()} ${ep.path}`;
      if (usedApis.has(apiStr)) continue;
      usedApis.add(apiStr);

      // Find matching code example for this API
      const matchingEx = examples.find(ex =>
        !usedExamples.has(ex.id) &&
        (ex.relatedApi === apiStr || ex.code.includes(ep.path) || (ep.operationId && ex.code.includes(ep.operationId)))
      );
      if (matchingEx) usedExamples.add(matchingEx.id);

      // Find matching pitfalls for this API
      const matchingPfs = pitfalls.filter(pf =>
        pf.relatedApi === apiStr ||
        (ep.deprecated && pf.kind === 'deprecated') ||
        (pf.kind === 'rate_limit') ||
        (pf.kind === 'breaking_change')
      );
      const stepPitfalls: string[] = [];
      for (const p of matchingPfs) {
        const pfStr = `[${p.kind}] ${p.title}: ${p.content}`;
        stepPitfalls.push(pfStr);
        usedPitfalls.add(pfStr);
      }

      // If the endpoint is deprecated, explicitly highlight it in step title/description
      const depWarning = ep.deprecated ? ' [DEPRECATED]' : '';

      orderedSteps.push({
        step: stepNumber++,
        title: `${apiStr}${depWarning}${ep.summary ? ` - ${ep.summary}` : ''}`,
        description: ep.description || ep.summary || `Execute documented ${apiStr} request with parameters: ${ep.parameters.map(p => `${p.name}${p.required ? ' (required)' : ''}`).join(', ')}`,
        evidenceLevel: 'documented_fact',
        apiEndpoint: apiStr,
        exampleCode: matchingEx?.code,
        pitfalls: stepPitfalls.length > 0 ? stepPitfalls : undefined,
        sourceUrl: ep.provenance?.sourceUrl || matchingEx?.sourceUrl,
        sourceChunkIds: matchingEx?.chunkId ? [matchingEx.chunkId] : undefined,
      });
    }

    // C. Remaining Code Examples as implementation steps
    for (const ex of examples) {
      if (usedExamples.has(ex.id)) continue;
      usedExamples.add(ex.id);

      const matchingPfs = pitfalls.filter(pf =>
        (ex.relatedApi && pf.relatedApi === ex.relatedApi) ||
        (ex.relatedSymbol && pf.relatedSymbol === ex.relatedSymbol)
      );
      const stepPitfalls = matchingPfs.map(p => `[${p.kind}] ${p.title}: ${p.content}`);
      stepPitfalls.forEach(p => usedPitfalls.add(p));

      orderedSteps.push({
        step: stepNumber++,
        title: ex.task,
        description: `Implement documented code example for ${ex.task} (${ex.language}${ex.framework ? ` / ${ex.framework}` : ''})`,
        evidenceLevel: 'documented_fact',
        apiEndpoint: ex.relatedApi,
        exampleCode: ex.code,
        pitfalls: stepPitfalls.length > 0 ? stepPitfalls : undefined,
        sourceUrl: ex.sourceUrl,
        sourceChunkIds: ex.chunkId ? [ex.chunkId] : undefined,
      });

      if (ex.relatedApi) usedApis.add(ex.relatedApi);
    }

    // D. If neither endpoints nor examples existed, check procedural chunks with strong relevance
    if (orderedSteps.length === 0) {
      for (const sr of searchResults.filter(s => s.score >= 5.0).slice(0, 3)) {
        orderedSteps.push({
          step: stepNumber++,
          title: sr.chunk.title || sr.chunk.sectionPath.join(' > ') || 'Documented Procedure',
          description: sr.chunk.content.substring(0, 300),
          evidenceLevel: 'inferred_relationship',
          sourceUrl: sr.chunk.provenance?.sourceUrl,
          sourceChunkIds: [sr.chunk.id],
        });
      }
    }

    // E. If documentation contains no relevant implementation steps, mark missing_information
    if (orderedSteps.length === 0) {
      orderedSteps.push({
        step: stepNumber++,
        title: 'Missing Implementation Knowledge',
        description: `The indexed documentation does not contain documented API endpoints, code examples, or procedures for: "${cleanGoal}".`,
        evidenceLevel: 'missing_information',
      });
    }

    // 5. Assemble Evidence-Based Validation Steps
    const validationSteps: RecipeValidationStep[] = [];
    let valStepNumber = 1;

    // Validation from API response schemas
    for (const ep of endpoints) {
      const okResponse = ep.responseSchema?.['200'] || ep.responseSchema?.['201'];
      if (okResponse && okResponse.schema) {
        const props = okResponse.schema.properties ? Object.keys(okResponse.schema.properties) : [];
        const propsDesc = props.length > 0 ? ` Expected properties: [${props.slice(0, 6).join(', ')}]` : '';
        const exampleStr = okResponse.example ? JSON.stringify(okResponse.example, null, 2) : undefined;

        validationSteps.push({
          step: valStepNumber++,
          description: `Verify ${ep.method.toUpperCase()} ${ep.path} returns HTTP ${okResponse.statusCode}.${propsDesc}`,
          evidenceLevel: 'documented_fact',
          expectedResponse: exampleStr || (props.length > 0 ? JSON.stringify(props) : undefined),
          sourceUrl: ep.provenance?.sourceUrl,
        });
      }
    }

    // Validation from code examples containing verification/assertion patterns
    for (const ex of examples) {
      if (/(?:constructEvent|verifySignature|assert|expect|validate|signature)/i.test(ex.code)) {
        validationSteps.push({
          step: valStepNumber++,
          description: `Validate event/data integrity using documented pattern from ${ex.task}`,
          evidenceLevel: 'documented_fact',
          testPattern: ex.code,
          sourceUrl: ex.sourceUrl,
        });
      }
    }

    // If no validation steps can be derived from evidence, do NOT invent any!
    if (validationSteps.length === 0) {
      validationSteps.push({
        step: 1,
        description: 'No response schemas, test instructions, or verification assertions are documented for this task.',
        evidenceLevel: 'missing_information',
      });
    }

    // Collect all pitfalls
    for (const pf of pitfalls) {
      const pfStr = `[${pf.kind}] ${pf.title}: ${pf.content}`;
      usedPitfalls.add(pfStr);
    }

    // Calculate confidence score strictly based on evidence
    let confidence = 0.0;
    const factSteps = orderedSteps.filter(s => s.evidenceLevel === 'documented_fact').length;
    const totalSteps = orderedSteps.length;

    if (totalSteps > 0 && factSteps > 0) {
      confidence += 0.4 * (factSteps / totalSteps);
      if (endpoints.length > 0) confidence += 0.3;
      if (examples.length > 0) confidence += 0.2;
      if (validationSteps.some(v => v.evidenceLevel === 'documented_fact')) confidence += 0.1;
    }

    confidence = Math.min(1.0, Math.round(confidence * 100) / 100);

    const recipeId = createHash('sha256')
      .update(`${cleanGoal}:${effectiveDocVersion || 'default'}:${orderedSteps.length}`)
      .digest('hex')
      .substring(0, 16);

    return {
      id: recipeId,
      goal: cleanGoal,
      prerequisites,
      orderedSteps,
      requiredApis: Array.from(usedApis),
      examples: Array.from(usedExamples),
      pitfalls: Array.from(usedPitfalls),
      validationSteps,
      sources,
      docVersion: effectiveDocVersion,
      confidence,
    };
  }
}
