import type {
  ApiEndpoint,
  ExtractedApiCall,
  Pitfall,
  VerificationFinding,
  VerificationResult,
  VerificationStatus,
} from '../../shared/src/index.ts';
import type { DocOrbitRepository } from '../../storage/src/index.ts';
import { matchEndpointPath } from './extractor.ts';

export interface VerifierOptions {
  docVersion?: string;
  projectVersion?: string;
  library?: string;
}

export class SchemaVerifier {
  private repo: DocOrbitRepository;

  constructor(repo: DocOrbitRepository) {
    this.repo = repo;
  }

  verify(calls: ExtractedApiCall[], options: VerifierOptions = {}): VerificationResult {
    const findings: VerificationFinding[] = [];
    const docVersion = options.docVersion;
    const projectVersion = options.projectVersion;

    // Load available endpoints and pitfalls for target version
    const allEndpoints = this.repo.searchApiEndpoints('', {
      docVersion,
      limit: 200,
    });
    const allPitfalls = this.repo.searchPitfalls('', {
      docVersion,
      limit: 100,
    });

    let totalChecks = 0;

    for (let i = 0; i < calls.length; i++) {
      const call = calls[i];

      // Handle ambiguous or unsupported calls
      if (call.isDynamicOrAmbiguous) {
        totalChecks++;
        findings.push({
          id: `find_ambiguous_${i}`,
          rule: 'endpoint_validity',
          severity: 'info',
          status: 'insufficient_evidence',
          message: call.reasonIfAmbiguous || 'Unable to statically verify dynamic or unsupported expression.',
          location: {
            line: call.line,
            snippet: call.rawSnippet,
          },
          confidence: 0.5,
        });
        continue;
      }

      // 1. Next.js Version Syntax Checks
      if (call.symbol?.startsWith('nextjs_route_params')) {
        this.verifyNextJsParams(call, projectVersion || docVersion, findings, i);
        totalChecks++;
        continue;
      }

      // If no endpoint path was extracted
      if (!call.endpointPath) {
        totalChecks++;
        findings.push({
          id: `find_no_path_${i}`,
          rule: 'endpoint_validity',
          severity: 'info',
          status: 'insufficient_evidence',
          message: 'No API path could be extracted from code call.',
          location: { line: call.line, snippet: call.rawSnippet },
          confidence: 0.5,
        });
        continue;
      }

      // 2. Endpoint Path Match
      const matchedEndpoints = allEndpoints.filter(ep =>
        matchEndpointPath(call.endpointPath!, ep.path)
      );

      if (matchedEndpoints.length === 0) {
        totalChecks++;
        // Check if endpoint exists in ANY version (to see if removed)
        const removedCheck = this.repo.searchApiEndpoints(call.endpointPath!, { limit: 5 });
        const removedPitfall = allPitfalls.find(
          p => p.kind === 'removed' && (p.relatedApi?.includes(call.endpointPath!) || p.content.includes(call.endpointPath!))
        );

        if (removedCheck.length > 0 || removedPitfall) {
          findings.push({
            id: `find_removed_${i}`,
            rule: 'removed_api',
            severity: 'error',
            status: 'mismatch',
            message: `Endpoint "${call.endpointPath}" was removed in API version ${docVersion || 'target'}.`,
            location: { line: call.line, snippet: call.rawSnippet },
            docVersion,
            provenance: removedCheck[0]?.provenance ? {
              sourceUrl: removedCheck[0].provenance.sourceUrl,
              endpointId: removedCheck[0].id,
            } : undefined,
            confidence: 0.95,
          });
        } else {
          findings.push({
            id: `find_endpoint_${i}`,
            rule: 'endpoint_validity',
            severity: 'error',
            status: 'mismatch',
            message: `Endpoint "${call.endpointPath}" does not exist in API documentation (version: ${docVersion || 'latest'}).`,
            location: { line: call.line, snippet: call.rawSnippet },
            docVersion,
            confidence: 0.9,
          });
        }
        continue;
      }

      // 3. HTTP Method Match
      const methodLower = (call.method || 'get').toLowerCase();
      const exactMethodEp = matchedEndpoints.find(ep => ep.method.toLowerCase() === methodLower);

      totalChecks++;
      if (!exactMethodEp) {
        const allowed = matchedEndpoints.map(ep => ep.method.toUpperCase()).join(', ');
        findings.push({
          id: `find_method_${i}`,
          rule: 'method_validity',
          severity: 'error',
          status: 'mismatch',
          message: `Endpoint "${call.endpointPath}" does not support HTTP method "${methodLower.toUpperCase()}". Supported methods: [${allowed}].`,
          location: { line: call.line, snippet: call.rawSnippet },
          expected: allowed,
          actual: methodLower.toUpperCase(),
          docVersion,
          provenance: matchedEndpoints[0].provenance ? {
            sourceUrl: matchedEndpoints[0].provenance.sourceUrl,
            endpointId: matchedEndpoints[0].id,
          } : undefined,
          confidence: 0.95,
        });
        continue;
      }

      // 4. Deprecation Checks
      totalChecks++;
      if (exactMethodEp.deprecated) {
        findings.push({
          id: `find_dep_${i}`,
          rule: 'deprecation',
          severity: 'warning',
          status: 'warning',
          message: `Endpoint "${exactMethodEp.method.toUpperCase()} ${exactMethodEp.path}" is deprecated in documentation (version: ${docVersion || 'current'}).`,
          location: { line: call.line, snippet: call.rawSnippet },
          docVersion,
          provenance: exactMethodEp.provenance ? {
            sourceUrl: exactMethodEp.provenance.sourceUrl,
            endpointId: exactMethodEp.id,
          } : undefined,
          confidence: 1.0,
        });
      }

      // Check for related deprecation pitfalls
      const depPitfall = allPitfalls.find(
        p => p.kind === 'deprecated' && (p.relatedApi?.includes(exactMethodEp.path) || p.content.includes(exactMethodEp.path))
      );
      if (depPitfall) {
        findings.push({
          id: `find_dep_pit_${i}`,
          rule: 'deprecation',
          severity: 'warning',
          status: 'warning',
          message: `Deprecation notice for ${exactMethodEp.path}: ${depPitfall.title}`,
          location: { line: call.line, snippet: call.rawSnippet },
          docVersion,
          provenance: depPitfall.provenance ? {
            sourceUrl: depPitfall.provenance.sourceUrl,
            pitfallId: depPitfall.id,
          } : undefined,
          confidence: 0.9,
        });
      }

      // 5. Required Parameters & Body Fields
      totalChecks++;
      this.verifyParameters(call, exactMethodEp, findings, i, docVersion);

      // 6. Response Assumptions
      if (call.responseFieldsAccessed && call.responseFieldsAccessed.length > 0 && exactMethodEp.responseSchema) {
        totalChecks++;
        this.verifyResponseFields(call, exactMethodEp, findings, i, docVersion);
      }
    }

    // Determine overall verdict
    let verdict: VerificationStatus = 'verified';
    if (findings.some(f => f.status === 'mismatch')) {
      verdict = 'mismatch';
    } else if (findings.some(f => f.status === 'warning')) {
      verdict = 'warning';
    } else if (findings.length > 0 && findings.every(f => f.status === 'insufficient_evidence')) {
      verdict = 'insufficient_evidence';
    }

    // Build summary string
    let summary: string;
    const mismatches = findings.filter(f => f.status === 'mismatch').length;
    const warnings = findings.filter(f => f.status === 'warning').length;

    if (verdict === 'verified') {
      summary = `All ${totalChecks} check(s) verified successfully against API documentation${docVersion ? ` (${docVersion})` : ''}.`;
    } else if (verdict === 'mismatch') {
      summary = `Verification failed with ${mismatches} mismatch(es) and ${warnings} warning(s).`;
    } else if (verdict === 'warning') {
      summary = `Verification passed with ${warnings} warning(s) (e.g. deprecated APIs or unverified fields).`;
    } else {
      summary = 'Verification inconclusive: insufficient evidence or unsupported expressions in code.';
    }

    return {
      verdict,
      summary,
      targetVersion: docVersion,
      projectVersion,
      matchedLibrary: options.library,
      findings,
      extractedCalls: calls,
      totalChecks,
      untrusted: true,
    };
  }

  private verifyParameters(
    call: ExtractedApiCall,
    ep: ApiEndpoint,
    findings: VerificationFinding[],
    idx: number,
    docVersion?: string
  ): void {
    const requiredParams = ep.parameters.filter(p => p.required);
    const bodyFields = new Set(call.bodyFields || []);

    // Check required query/path parameters
    for (const req of requiredParams) {
      if (req.in === 'path') {
        // Path parameters are verified by URL structure match
        continue;
      }
      if (!bodyFields.has(req.name) && !(call.parameters && req.name in call.parameters)) {
        findings.push({
          id: `find_req_param_${idx}_${req.name}`,
          rule: 'required_parameters',
          severity: 'error',
          status: 'mismatch',
          message: `Missing required parameter "${req.name}" (${req.in}) for ${ep.method.toUpperCase()} ${ep.path}.`,
          location: { line: call.line, snippet: call.rawSnippet },
          expected: req.name,
          docVersion,
          provenance: ep.provenance ? {
            sourceUrl: ep.provenance.sourceUrl,
            endpointId: ep.id,
          } : undefined,
          confidence: 0.95,
        });
      }
    }

    // Check request body schema required fields
    if (ep.requestSchema?.required && Array.isArray(ep.requestSchema.required)) {
      for (const reqField of ep.requestSchema.required) {
        if (!bodyFields.has(reqField)) {
          findings.push({
            id: `find_req_body_${idx}_${reqField}`,
            rule: 'required_parameters',
            severity: 'error',
            status: 'mismatch',
            message: `Missing required body field "${reqField}" for ${ep.method.toUpperCase()} ${ep.path}.`,
            location: { line: call.line, snippet: call.rawSnippet },
            expected: reqField,
            docVersion,
            provenance: ep.provenance ? {
              sourceUrl: ep.provenance.sourceUrl,
              endpointId: ep.id,
            } : undefined,
            confidence: 0.95,
          });
        }
      }
    }
  }

  private verifyResponseFields(
    call: ExtractedApiCall,
    ep: ApiEndpoint,
    findings: VerificationFinding[],
    idx: number,
    docVersion?: string
  ): void {
    // Collect all documented response property names across 200/201 schemas
    const documentedProps = new Set<string>();
    for (const [status, resp] of Object.entries(ep.responseSchema || {})) {
      if (status.startsWith('2') && resp.schema?.properties) {
        for (const propName of Object.keys(resp.schema.properties)) {
          documentedProps.add(propName);
        }
      }
    }

    if (documentedProps.size === 0) return;

    for (const accessedField of call.responseFieldsAccessed || []) {
      if (!documentedProps.has(accessedField)) {
        findings.push({
          id: `find_resp_${idx}_${accessedField}`,
          rule: 'response_assumption',
          severity: 'warning',
          status: 'warning',
          message: `Field "${accessedField}" accessed from response is not in documented 2xx response schema for ${ep.method.toUpperCase()} ${ep.path}.`,
          location: { line: call.line, snippet: call.rawSnippet },
          actual: accessedField,
          docVersion,
          provenance: ep.provenance ? {
            sourceUrl: ep.provenance.sourceUrl,
            endpointId: ep.id,
          } : undefined,
          confidence: 0.75,
        });
      }
    }
  }

  private verifyNextJsParams(
    call: ExtractedApiCall,
    version: string | undefined,
    findings: VerificationFinding[],
    idx: number
  ): void {
    const isV14 = version?.includes('14') || version?.startsWith('v14');
    const isV15OrAbove = version?.includes('15') || version?.includes('16') || version?.startsWith('v15') || version?.startsWith('v16');

    if (call.symbol === 'nextjs_route_params_async' && isV14) {
      findings.push({
        id: `find_nextjs_${idx}`,
        rule: 'version_mismatch',
        severity: 'error',
        status: 'mismatch',
        message: 'Next.js 14 requires synchronous route params ("params.slug"). "await params" is only supported in Next.js 15+.',
        location: { line: call.line, snippet: call.rawSnippet },
        docVersion: version,
        confidence: 0.95,
      });
    } else if (call.symbol === 'nextjs_route_params_sync' && isV15OrAbove) {
      findings.push({
        id: `find_nextjs_${idx}`,
        rule: 'deprecation',
        severity: 'warning',
        status: 'warning',
        message: 'Synchronous route params ("params.slug") is deprecated in Next.js 15 and removed in Next.js 16. Use "await params".',
        location: { line: call.line, snippet: call.rawSnippet },
        docVersion: version,
        confidence: 0.95,
      });
    }
  }
}
