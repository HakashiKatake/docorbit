import { createHash } from 'node:crypto';
import type {
  OpenApiSummary,
  ApiEndpoint,
  ApiParameter,
  ApiSchema,
  ApiResponse,
  ApiAuthScheme,
  ApiErrorResponse,
  ApiPaginationMetadata,
  Provenance,
} from '../../../shared/src/index.ts';
import { resolveJsonPointer, normalizeSchema } from './schema-resolver.ts';

/**
 * Detects if a document content is an OpenAPI or Swagger specification.
 */
export function detectOpenApiSpec(content: string, sourceUrl: string): OpenApiSummary | null {
  if (!content || typeof content !== 'string') return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;

  const openapiVer = typeof parsed.openapi === 'string' ? parsed.openapi : undefined;
  const swaggerVer = typeof parsed.swagger === 'string' ? parsed.swagger : undefined;

  const specVersion = openapiVer || swaggerVer;
  if (!specVersion) return null;

  const info = (typeof parsed.info === 'object' && parsed.info !== null)
    ? (parsed.info as Record<string, unknown>)
    : {};

  const title = typeof info.title === 'string' ? info.title : 'Untitled API';
  const description = typeof info.description === 'string' ? info.description : undefined;

  const servers: string[] = [];
  if (Array.isArray(parsed.servers)) {
    for (const server of parsed.servers) {
      if (server && typeof server === 'object' && typeof (server as Record<string, unknown>).url === 'string') {
        servers.push((server as Record<string, unknown>).url as string);
      }
    }
  } else if (typeof parsed.host === 'string') {
    const basePath = typeof parsed.basePath === 'string' ? parsed.basePath : '';
    const schemes = Array.isArray(parsed.schemes) ? parsed.schemes : ['https'];
    servers.push(`${schemes[0]}://${parsed.host}${basePath}`);
  }

  let pathCount = 0;
  if (typeof parsed.paths === 'object' && parsed.paths !== null) {
    pathCount = Object.keys(parsed.paths).length;
  }

  return {
    specVersion,
    title,
    description,
    servers,
    pathCount,
    sourceUrl,
    rawJson: parsed,
  };
}

/**
 * Parses all API endpoints from an OpenAPI 3.x or Swagger 2.0 specification.
 * Fully deterministic with internal $ref resolution, schema normalization,
 * pagination heuristics, and error detection.
 */
export function parseOpenApiEndpoints(
  rawSpec: string | Record<string, unknown>,
  pageId: string,
  snapshotId: string,
  sourceUrl?: string,
  docVersion?: string
): ApiEndpoint[] {
  let root: Record<string, unknown>;
  if (typeof rawSpec === 'string') {
    try {
      root = JSON.parse(rawSpec);
    } catch {
      return [];
    }
  } else {
    root = rawSpec;
  }

  if (!root || typeof root !== 'object') return [];

  const isOpenApi3 = typeof root.openapi === 'string';
  const isSwagger2 = typeof root.swagger === 'string';
  if (!isOpenApi3 && !isSwagger2) return [];

  const paths = (typeof root.paths === 'object' && root.paths !== null)
    ? (root.paths as Record<string, unknown>)
    : {};

  const endpoints: ApiEndpoint[] = [];
  const supportedMethods = new Set(['get', 'post', 'put', 'delete', 'patch', 'head', 'options']);

  // Extract root-level security schemes
  const securitySchemesMap = new Map<string, ApiAuthScheme>();
  if (isOpenApi3 && root.components && typeof root.components === 'object') {
    const comps = root.components as Record<string, unknown>;
    if (typeof comps.securitySchemes === 'object' && comps.securitySchemes !== null) {
      for (const [name, schemeRaw] of Object.entries(comps.securitySchemes as Record<string, unknown>)) {
        if (typeof schemeRaw === 'object' && schemeRaw !== null) {
          const s = schemeRaw as Record<string, unknown>;
          securitySchemesMap.set(name, {
            type: (s.type as ApiAuthScheme['type']) || 'http',
            name: typeof s.name === 'string' ? s.name : name,
            in: s.in as ApiAuthScheme['in'],
            scheme: typeof s.scheme === 'string' ? s.scheme : undefined,
            bearerFormat: typeof s.bearerFormat === 'string' ? s.bearerFormat : undefined,
            description: typeof s.description === 'string' ? s.description : undefined,
          });
        }
      }
    }
  } else if (isSwagger2 && typeof root.securityDefinitions === 'object' && root.securityDefinitions !== null) {
    for (const [name, schemeRaw] of Object.entries(root.securityDefinitions as Record<string, unknown>)) {
      if (typeof schemeRaw === 'object' && schemeRaw !== null) {
        const s = schemeRaw as Record<string, unknown>;
        const rawType = typeof s.type === 'string' ? s.type : 'apiKey';
        let mappedType: ApiAuthScheme['type'] = 'apiKey';
        let mappedScheme: string | undefined = undefined;

        if (rawType === 'basic') {
          mappedType = 'http';
          mappedScheme = 'basic';
        } else if (rawType === 'oauth2') {
          mappedType = 'oauth2';
        }

        securitySchemesMap.set(name, {
          type: mappedType,
          name: typeof s.name === 'string' ? s.name : name,
          in: s.in as ApiAuthScheme['in'],
          scheme: mappedScheme,
          description: typeof s.description === 'string' ? s.description : undefined,
        });
      }
    }
  }

  // Root security fallback
  const rootSecurityReqs: Array<Record<string, unknown>> = Array.isArray(root.security)
    ? (root.security as Array<Record<string, unknown>>)
    : [];

  const nowIso = new Date().toISOString();

  for (const [pathStr, pathItemRaw] of Object.entries(paths)) {
    if (!pathItemRaw || typeof pathItemRaw !== 'object') continue;
    const pathItem = pathItemRaw as Record<string, unknown>;

    // Common path-level parameters
    const pathCommonParams: unknown[] = Array.isArray(pathItem.parameters) ? pathItem.parameters : [];

    for (const [methodKey, operationRaw] of Object.entries(pathItem)) {
      const method = methodKey.toLowerCase();
      if (!supportedMethods.has(method)) continue;
      if (!operationRaw || typeof operationRaw !== 'object') continue;

      const op = operationRaw as Record<string, unknown>;

      // Summary & Description
      const summary = typeof op.summary === 'string' ? op.summary : undefined;
      const description = typeof op.description === 'string' ? op.description : undefined;
      const operationId = typeof op.operationId === 'string' ? op.operationId : undefined;
      const deprecated = Boolean(op.deprecated || pathItem.deprecated);

      // Parameters
      const rawParams: unknown[] = [...pathCommonParams, ...(Array.isArray(op.parameters) ? op.parameters : [])];
      const parameters: ApiParameter[] = [];
      let swaggerBodySchema: unknown = undefined;

      for (const pRaw of rawParams) {
        let p = pRaw as Record<string, unknown>;
        if (typeof p.$ref === 'string') {
          const resolved = resolveJsonPointer(root, p.$ref);
          if (typeof resolved === 'object' && resolved !== null) {
            p = resolved as Record<string, unknown>;
          }
        }

        if (isSwagger2 && p.in === 'body') {
          swaggerBodySchema = p.schema;
          continue;
        }

        const name = typeof p.name === 'string' ? p.name : '';
        const paramIn = (typeof p.in === 'string' ? p.in : 'query') as ApiParameter['in'];
        const required = paramIn === 'path' ? true : Boolean(p.required);
        const pDesc = typeof p.description === 'string' ? p.description : undefined;
        const pDefault = p.default !== undefined ? p.default : (p.schema && typeof p.schema === 'object' ? (p.schema as Record<string, unknown>).default : undefined);
        const pExample = p.example !== undefined ? p.example : (p.schema && typeof p.schema === 'object' ? (p.schema as Record<string, unknown>).example : undefined);

        let pType: string | undefined = typeof p.type === 'string' ? p.type : undefined;
        let pSchema: Record<string, unknown> | undefined = undefined;

        if (p.schema && typeof p.schema === 'object') {
          pSchema = p.schema as Record<string, unknown>;
          if (!pType && typeof pSchema.type === 'string') {
            pType = pSchema.type;
          }
        }

        parameters.push({
          name,
          in: paramIn,
          required,
          type: pType,
          description: pDesc,
          default: pDefault,
          schema: pSchema,
          example: pExample,
        });
      }

      // Request Body
      let requestSchema: ApiSchema | undefined = undefined;
      if (isOpenApi3 && op.requestBody && typeof op.requestBody === 'object') {
        let rb = op.requestBody as Record<string, unknown>;
        if (typeof rb.$ref === 'string') {
          const resolved = resolveJsonPointer(root, rb.$ref);
          if (typeof resolved === 'object' && resolved !== null) {
            rb = resolved as Record<string, unknown>;
          }
        }
        if (typeof rb.content === 'object' && rb.content !== null) {
          const content = rb.content as Record<string, unknown>;
          // Prefer application/json, then application/x-www-form-urlencoded, fallback to first media type
          const mediaTypeObj = (content['application/json'] || content['application/x-www-form-urlencoded'] || Object.values(content)[0]) as Record<string, unknown> | undefined;
          if (mediaTypeObj && mediaTypeObj.schema) {
            requestSchema = normalizeSchema(mediaTypeObj.schema, root);
          }
        }
      } else if (isSwagger2 && swaggerBodySchema) {
        requestSchema = normalizeSchema(swaggerBodySchema, root);
      }

      // If request body schema defines properties, expose them as body parameters for discovery and indexing
      if (requestSchema && typeof requestSchema.properties === 'object' && requestSchema.properties !== null) {
        const reqFields = new Set(requestSchema.required || []);
        for (const [propName, propValRaw] of Object.entries(requestSchema.properties)) {
          if (parameters.some(p => p.name === propName)) continue;
          const propVal = (typeof propValRaw === 'object' && propValRaw !== null)
            ? (propValRaw as Record<string, unknown>)
            : {};
          const pType = typeof propVal.type === 'string'
            ? propVal.type
            : (Array.isArray(propVal.type) ? propVal.type.join(' | ') : undefined);
          const pDesc = typeof propVal.description === 'string' ? propVal.description : undefined;
          const pDefault = propVal.default;
          const pExample = propVal.example;
          parameters.push({
            name: propName,
            in: 'body',
            required: reqFields.has(propName),
            type: pType,
            description: pDesc,
            default: pDefault,
            schema: propVal,
            example: pExample,
          });
        }
      }

      // Responses & Errors
      const responseSchema: Record<string, ApiResponse> = {};
      const errors: ApiErrorResponse[] = [];

      if (typeof op.responses === 'object' && op.responses !== null) {
        for (const [statusCode, resRaw] of Object.entries(op.responses as Record<string, unknown>)) {
          let res = resRaw as Record<string, unknown>;
          if (typeof res.$ref === 'string') {
            const resolved = resolveJsonPointer(root, res.$ref);
            if (typeof resolved === 'object' && resolved !== null) {
              res = resolved as Record<string, unknown>;
            }
          }

          const resDesc = typeof res.description === 'string' ? res.description : '';
          let contentType: string | undefined = undefined;
          let resSchemaObj: unknown = undefined;
          let resExample: unknown = undefined;

          if (isOpenApi3 && typeof res.content === 'object' && res.content !== null) {
            const content = res.content as Record<string, unknown>;
            const ctKey = content['application/json'] ? 'application/json' : Object.keys(content)[0];
            contentType = ctKey;
            const mediaObj = content[ctKey] as Record<string, unknown> | undefined;
            if (mediaObj) {
              resSchemaObj = mediaObj.schema;
              resExample = mediaObj.example || (mediaObj.examples ? Object.values(mediaObj.examples as Record<string, unknown>)[0] : undefined);
            }
          } else if (isSwagger2) {
            resSchemaObj = res.schema;
            contentType = 'application/json';
            resExample = res.examples ? Object.values(res.examples as Record<string, unknown>)[0] : undefined;
          }

          const normalizedResSchema = normalizeSchema(resSchemaObj, root);

          const apiResponse: ApiResponse = {
            statusCode,
            description: resDesc,
            contentType,
            schema: normalizedResSchema,
            example: resExample,
          };

          responseSchema[statusCode] = apiResponse;

          // Detect errors
          const isErrorCode = statusCode.startsWith('4') || statusCode.startsWith('5') || statusCode === 'default';
          if (isErrorCode) {
            errors.push({
              statusCode,
              description: resDesc,
              schema: normalizedResSchema,
              example: resExample,
            });
          }
        }
      }

      // Authentication Schemes
      const auth: ApiAuthScheme[] = [];
      const opSecurityReqs: Array<Record<string, unknown>> = Array.isArray(op.security)
        ? (op.security as Array<Record<string, unknown>>)
        : rootSecurityReqs;

      for (const req of opSecurityReqs) {
        if (typeof req !== 'object' || req === null) continue;
        for (const schemeName of Object.keys(req)) {
          const found = securitySchemesMap.get(schemeName);
          if (found) {
            // Avoid duplicate schemes
            if (!auth.some(a => a.name === found.name && a.type === found.type)) {
              auth.push(found);
            }
          } else {
            auth.push({
              type: 'apiKey',
              name: schemeName,
            });
          }
        }
      }

      // Pagination Heuristics
      let pagination: ApiPaginationMetadata | undefined = undefined;
      const paramNames = parameters.map(p => p.name.toLowerCase());
      const cursorParams = paramNames.filter(n => ['starting_after', 'ending_before', 'cursor', 'next_cursor', 'after', 'before'].includes(n));
      const offsetParams = paramNames.filter(n => ['offset', 'skip', 'start'].includes(n));
      const pageParams = paramNames.filter(n => ['page', 'page_number', 'pagenumber'].includes(n));
      const limitParams = paramNames.filter(n => ['limit', 'per_page', 'page_size', 'pagesize', 'count', 'max'].includes(n));

      // Inspect response properties for pagination clues
      const okResponse = responseSchema['200'] || responseSchema['201'];
      const responseProps = okResponse?.schema?.properties ? Object.keys(okResponse.schema.properties) : [];
      const detectedResponseFields = responseProps.filter(prop =>
        ['has_more', 'next_cursor', 'cursor', 'next_page', 'page_info', 'total_count', 'data', 'items', 'results'].includes(prop.toLowerCase())
      );

      if (cursorParams.length > 0) {
        pagination = {
          type: 'cursor',
          parameters: [...cursorParams, ...limitParams],
          responseFields: detectedResponseFields,
        };
      } else if (offsetParams.length > 0) {
        pagination = {
          type: 'offset',
          parameters: [...offsetParams, ...limitParams],
          responseFields: detectedResponseFields,
        };
      } else if (pageParams.length > 0) {
        pagination = {
          type: 'page',
          parameters: [...pageParams, ...limitParams],
          responseFields: detectedResponseFields,
        };
      }

      // Deterministic Endpoint ID
      const endpointId = createHash('sha256')
        .update(`${pageId}:${method}:${pathStr}`)
        .digest('hex')
        .substring(0, 16);

      const provenance: Provenance | undefined = sourceUrl
        ? {
            sourceUrl,
            retrievedAt: nowIso,
            sourceAuthority: 'official',
          }
        : undefined;

      endpoints.push({
        id: endpointId,
        pageId,
        snapshotId,
        method: method as ApiEndpoint['method'],
        path: pathStr,
        summary,
        description,
        operationId,
        parameters,
        requestSchema,
        responseSchema,
        auth,
        errors,
        pagination,
        deprecated,
        docVersion,
        provenance,
        createdAt: nowIso,
      });
    }
  }

  return endpoints;
}
