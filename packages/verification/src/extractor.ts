import type { ExtractedApiCall } from '../../shared/src/index.ts';

/**
 * Normalizes an API path for comparison against schema paths.
 * E.g. extracts pathname from full URLs ("https://api.stripe.com/v1/webhook_endpoints" -> "/v1/webhook_endpoints")
 */
export function normalizeApiPath(urlOrPath: string): string {
  try {
    if (urlOrPath.startsWith('http://') || urlOrPath.startsWith('https://')) {
      const parsed = new URL(urlOrPath);
      return parsed.pathname;
    }
  } catch {
    // Fall back to regex
  }
  const match = urlOrPath.match(/^https?:\/\/[^/]+(\/.*)$/);
  if (match) return match[1].split('?')[0];
  return urlOrPath.split('?')[0].trim();
}

/**
 * Checks if an extracted path matches an OpenAPI schema path template.
 * E.g. candidate "/v1/webhook_endpoints/we_123" matches schema "/v1/webhook_endpoints/{id}"
 */
export function matchEndpointPath(candidatePath: string, schemaPath: string): boolean {
  const normCandidate = normalizeApiPath(candidatePath).replace(/\/+$/, '');
  const normSchema = normalizeApiPath(schemaPath).replace(/\/+$/, '');

  if (normCandidate.toLowerCase() === normSchema.toLowerCase()) {
    return true;
  }

  // Convert schema {param} or :param to regex wildcard
  const regexPattern = normSchema
    .replace(/{[^}]+}/g, '([^/]+)')
    .replace(/:[a-zA-Z0-9_]+/g, '([^/]+)')
    .replace(/\//g, '\\/');

  const regex = new RegExp(`^${regexPattern}$`, 'i');
  return regex.test(normCandidate);
}

/**
 * Extracts top-level key names from a JS/Python object or JSON snippet string.
 */
function extractObjectKeys(objSnippet: string): string[] {
  const keys: Set<string> = new Set();
  // Try standard JSON parse first
  try {
    const parsed = JSON.parse(objSnippet);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.keys(parsed);
    }
  } catch {
    // Fall back to lexical key extraction
  }

  // Match identifier keys: { foo: ..., "bar": ..., 'baz': ... }
  const keyRegex = /(?:[{,]\s*)(?:["']?([a-zA-Z0-9_-]+)["']?)\s*:/g;
  let match: RegExpExecArray | null;
  while ((match = keyRegex.exec(objSnippet)) !== null) {
    if (match[1] && !['method', 'headers', 'body'].includes(match[1])) {
      keys.add(match[1]);
    }
  }

  return Array.from(keys);
}

/**
 * Deterministically extracts API calls, parameters, methods, and version syntax from code.
 */
export class CodeApiExtractor {
  /**
   * Extracts API calls from code.
   */
  extract(code: string, language?: string): ExtractedApiCall[] {
    const results: ExtractedApiCall[] = [];
    const lines = code.split('\n');

    // 1. Check for Next.js Route Params patterns (sync vs async)
    this.extractNextJsParams(code, lines, results);

    // 2. Extract Fetch calls: fetch('url', { method: 'POST', body: ... })
    this.extractFetchCalls(code, lines, results);

    // 3. Extract Axios calls: axios.post('url', {...}) / axios.get('url')
    this.extractAxiosCalls(code, lines, results);

    // 4. Extract Python Requests calls: requests.post('url', json={...})
    this.extractPythonRequestsCalls(code, lines, results);

    // 5. Extract cURL commands: curl -X POST ...
    this.extractCurlCalls(code, lines, results);

    // 6. Extract common SDK calls: stripe.webhookEndpoints.create({...}), etc.
    this.extractSdkCalls(code, lines, results);

    // 7. Check for dynamic / unresolvable URLs: e.g. fetch(apiUrl) or axios.get(endpoint)
    this.extractDynamicCalls(code, lines, results);

    // If nothing was extracted at all, create an ambiguous marker
    if (results.length === 0) {
      results.push({
        rawSnippet: code.slice(0, 150),
        isDynamicOrAmbiguous: true,
        reasonIfAmbiguous: language && !['javascript', 'typescript', 'python', 'curl', 'bash'].includes(language.toLowerCase())
          ? `Language "${language}" is not currently supported for deep AST schema verification.`
          : 'No recognizable HTTP/API client calls, SDK invocations, or endpoint paths found in code.',
        language,
      });
    }

    return results;
  }

  private findLineNumber(lines: string[], snippetPattern: string): number {
    const clean = snippetPattern.trim().split('\n')[0].slice(0, 40);
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(clean)) return i + 1;
    }
    return 1;
  }

  private extractNextJsParams(code: string, lines: string[], results: ExtractedApiCall[]): void {
    // Next.js 14 sync: params.slug, const { slug } = params
    const syncParamRegex = /(?:const\s+{\s*([^}]+)\s*}\s*=\s*params\b|\bparams\.([a-zA-Z0-9_]+))/;
    // Next.js 15+ async: await params, const { slug } = await params
    const asyncParamRegex = /(?:await\s+params\b|const\s+{\s*([^}]+)\s*}\s*=\s*await\s+params\b)/;

    const hasAsync = asyncParamRegex.test(code);
    const hasSync = syncParamRegex.test(code) && !hasAsync;

    if (hasAsync) {
      const match = code.match(asyncParamRegex);
      results.push({
        symbol: 'nextjs_route_params_async',
        endpointPath: 'nextjs/app_router/params',
        method: 'get',
        rawSnippet: match ? match[0] : 'await params',
        line: match ? this.findLineNumber(lines, match[0]) : 1,
      });
    } else if (hasSync) {
      const match = code.match(syncParamRegex);
      results.push({
        symbol: 'nextjs_route_params_sync',
        endpointPath: 'nextjs/app_router/params',
        method: 'get',
        rawSnippet: match ? match[0] : 'params.slug',
        line: match ? this.findLineNumber(lines, match[0]) : 1,
      });
    }
  }

  private extractFetchCalls(code: string, lines: string[], results: ExtractedApiCall[]): void {
    // Matches: fetch(['"`]([^'"`]+)['"`](?:\s*,\s*({[\s\S]*?}))?\s*\)
    const fetchRegex = /fetch\s*\(\s*['"`]([^'"`]+)['"`](?:\s*,\s*({[\s\S]*?}))?\s*\)/g;
    let match: RegExpExecArray | null;

    while ((match = fetchRegex.exec(code)) !== null) {
      const url = match[1];
      const optionsSnippet = match[2] || '';
      const endpointPath = normalizeApiPath(url);

      let method = 'get';
      const methodMatch = optionsSnippet.match(/method\s*:\s*['"]([a-zA-Z]+)['"]/i);
      if (methodMatch) {
        method = methodMatch[1].toLowerCase();
      }

      // Extract body fields if body: JSON.stringify({...}) or body: {...}
      let bodyFields: string[] = [];
      const bodyMatch = optionsSnippet.match(/body\s*:\s*(?:JSON\.stringify\s*\(\s*)?({[\s\S]*?})(?:\s*\))?/);
      if (bodyMatch) {
        bodyFields = extractObjectKeys(bodyMatch[1]);
      }

      // Extract response fields accessed: e.g. data.foo, res.json()
      const responseFields = this.extractResponseFields(code, endpointPath);

      results.push({
        endpointPath,
        method,
        bodyFields,
        responseFieldsAccessed: responseFields,
        rawSnippet: match[0],
        line: this.findLineNumber(lines, match[0]),
        language: 'javascript',
      });
    }
  }

  private extractAxiosCalls(code: string, lines: string[], results: ExtractedApiCall[]): void {
    // Matches: axios.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`](?:\s*,\s*({[\s\S]*?}))?/g
    const axiosRegex = /axios\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`](?:\s*,\s*({[\s\S]*?}))?/g;
    let match: RegExpExecArray | null;

    while ((match = axiosRegex.exec(code)) !== null) {
      const method = match[1].toLowerCase();
      const url = match[2];
      const payloadSnippet = match[3] || '';
      const endpointPath = normalizeApiPath(url);
      const bodyFields = payloadSnippet ? extractObjectKeys(payloadSnippet) : [];
      const responseFields = this.extractResponseFields(code, endpointPath);

      results.push({
        endpointPath,
        method,
        bodyFields,
        responseFieldsAccessed: responseFields,
        rawSnippet: match[0],
        line: this.findLineNumber(lines, match[0]),
        language: 'javascript',
      });
    }
  }

  private extractPythonRequestsCalls(code: string, lines: string[], results: ExtractedApiCall[]): void {
    // Matches: requests.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"](?:\s*,\s*(?:json|data)\s*=\s*({[\s\S]*?}))?
    const requestsRegex = /requests\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"](?:\s*,\s*(?:json|data|params)\s*=\s*({[\s\S]*?}))?/g;
    let match: RegExpExecArray | null;

    while ((match = requestsRegex.exec(code)) !== null) {
      const method = match[1].toLowerCase();
      const url = match[2];
      const payloadSnippet = match[3] || '';
      const endpointPath = normalizeApiPath(url);
      const bodyFields = payloadSnippet ? extractObjectKeys(payloadSnippet) : [];

      results.push({
        endpointPath,
        method,
        bodyFields,
        rawSnippet: match[0],
        line: this.findLineNumber(lines, match[0]),
        language: 'python',
      });
    }
  }

  private extractCurlCalls(code: string, lines: string[], results: ExtractedApiCall[]): void {
    // Matches: curl ... https://... -X POST -d '{...}'
    const curlRegex = /curl\s+([^\n]+)/g;
    let match: RegExpExecArray | null;

    while ((match = curlRegex.exec(code)) !== null) {
      const fullCmd = match[1];
      const urlMatch = fullCmd.match(/https?:\/\/[^\s'"]+/);
      if (!urlMatch) continue;

      const endpointPath = normalizeApiPath(urlMatch[0]);
      let method = 'get';
      const methodMatch = fullCmd.match(/-X\s+([A-Z]+)/i);
      if (methodMatch) {
        method = methodMatch[1].toLowerCase();
      } else if (fullCmd.includes('-d ') || fullCmd.includes('--data')) {
        method = 'post';
      }

      let bodyFields: string[] = [];
      const dataMatch = fullCmd.match(/(?:-d|--data(?:-raw)?)\s+['"]({[\s\S]*?})['"]/);
      if (dataMatch) {
        bodyFields = extractObjectKeys(dataMatch[1]);
      }

      results.push({
        endpointPath,
        method,
        bodyFields,
        rawSnippet: match[0],
        line: this.findLineNumber(lines, match[0]),
        language: 'curl',
      });
    }
  }

  private extractSdkCalls(code: string, lines: string[], results: ExtractedApiCall[]): void {
    // Stripe SDK: stripe.webhookEndpoints.create({...})
    const stripeWebhookRegex = /stripe\.webhookEndpoints\.create\s*\(\s*({[\s\S]*?})\s*\)/g;
    let match: RegExpExecArray | null;
    while ((match = stripeWebhookRegex.exec(code)) !== null) {
      const bodyFields = extractObjectKeys(match[1]);
      results.push({
        endpointPath: '/v1/webhook_endpoints',
        method: 'post',
        symbol: 'stripe.webhookEndpoints.create',
        bodyFields,
        rawSnippet: match[0],
        line: this.findLineNumber(lines, match[0]),
      });
    }

    // Stripe SDK: stripe.charges.create({...})
    const stripeChargesRegex = /stripe\.charges\.create\s*\(\s*({[\s\S]*?})\s*\)/g;
    while ((match = stripeChargesRegex.exec(code)) !== null) {
      const bodyFields = extractObjectKeys(match[1]);
      results.push({
        endpointPath: '/v1/charges',
        method: 'post',
        symbol: 'stripe.charges.create',
        bodyFields,
        rawSnippet: match[0],
        line: this.findLineNumber(lines, match[0]),
      });
    }
  }

  private extractDynamicCalls(code: string, lines: string[], results: ExtractedApiCall[]): void {
    // Matches fetch(dynamicVar) or axios.get(dynamicVar) where argument does not start with string quote
    const dynamicFetch = /fetch\s*\(\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*(?:,|\))/g;
    let match: RegExpExecArray | null;
    while ((match = dynamicFetch.exec(code)) !== null) {
      const varName = match[1];
      // Check if variable is defined as a string literal above
      const defRegex = new RegExp(`(?:const|let|var)\\s+${varName}\\s*=\\s*['"\`]([^'"\`]+)['"\`]`);
      if (!defRegex.test(code)) {
        results.push({
          rawSnippet: match[0],
          isDynamicOrAmbiguous: true,
          reasonIfAmbiguous: `Dynamic variable "${varName}" passed to fetch() cannot be statically resolved to an API path.`,
          line: this.findLineNumber(lines, match[0]),
        });
      }
    }
  }

  private extractResponseFields(code: string, _endpoint: string): string[] {
    const fields: Set<string> = new Set();
    // Matches res.data.fieldName or data.fieldName or json.fieldName or event.fieldName
    const fieldRegex = /(?:res(?:ponse)?(?:\.data)?|data|json|body|payload)\.([a-zA-Z0-9_]+)/g;
    let m: RegExpExecArray | null;
    while ((m = fieldRegex.exec(code)) !== null) {
      if (m[1] && !['json', 'status', 'headers', 'data', 'text'].includes(m[1])) {
        fields.add(m[1]);
      }
    }
    return Array.from(fields);
  }
}
