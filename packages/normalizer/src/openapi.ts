import type { OpenApiSummary } from '../../shared/src/index.ts';

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
