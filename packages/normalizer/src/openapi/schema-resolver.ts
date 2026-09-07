import type { ApiSchema } from '../../../shared/src/index.ts';

/**
 * Resolves a JSON Pointer (e.g. `#/components/schemas/Pet` or `#/definitions/Pet`)
 * within the root document. Handles circular references safely.
 */
export function resolveJsonPointer(
  root: Record<string, unknown>,
  pointer: string,
  visited: Set<string> = new Set()
): unknown {
  if (visited.has(pointer)) {
    return { $ref: pointer, description: '[Circular Reference]' };
  }
  visited.add(pointer);

  if (!pointer.startsWith('#/')) {
    return { $ref: pointer, description: '[External Reference]' };
  }

  const parts = pointer.slice(2).split('/').map((part) =>
    part.replace(/~1/g, '/').replace(/~0/g, '~')
  );

  let current: unknown = root;
  for (const part of parts) {
    if (typeof current !== 'object' || current === null) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  // If the resolved object itself is a reference, resolve further
  if (
    typeof current === 'object' &&
    current !== null &&
    typeof (current as Record<string, unknown>).$ref === 'string'
  ) {
    return resolveJsonPointer(
      root,
      (current as Record<string, unknown>).$ref as string,
      visited
    );
  }

  return current;
}

/**
 * Normalizes an OpenAPI / JSON schema object into an ApiSchema model.
 */
export function normalizeSchema(
  rawSchema: unknown,
  root: Record<string, unknown>,
  visited: Set<string> = new Set()
): ApiSchema | undefined {
  if (!rawSchema || typeof rawSchema !== 'object') return undefined;

  let schemaObj = rawSchema as Record<string, unknown>;

  if (typeof schemaObj.$ref === 'string') {
    const resolved = resolveJsonPointer(root, schemaObj.$ref, visited);
    if (typeof resolved === 'object' && resolved !== null) {
      schemaObj = resolved as Record<string, unknown>;
    }
  }

  const type = typeof schemaObj.type === 'string'
    ? schemaObj.type
    : (Array.isArray(schemaObj.type) ? schemaObj.type.join(' | ') : undefined);

  const description = typeof schemaObj.description === 'string'
    ? schemaObj.description
    : undefined;

  const required = Array.isArray(schemaObj.required)
    ? schemaObj.required.filter((r): r is string => typeof r === 'string')
    : undefined;

  let properties: Record<string, unknown> | undefined;
  if (typeof schemaObj.properties === 'object' && schemaObj.properties !== null) {
    properties = {};
    for (const [k, v] of Object.entries(schemaObj.properties as Record<string, unknown>)) {
      if (typeof v === 'object' && v !== null && typeof (v as Record<string, unknown>).$ref === 'string') {
        const refResolved = resolveJsonPointer(root, (v as Record<string, unknown>).$ref as string, new Set(visited));
        properties[k] = refResolved || v;
      } else {
        properties[k] = v;
      }
    }
  }

  let items: Record<string, unknown> | undefined;
  if (typeof schemaObj.items === 'object' && schemaObj.items !== null) {
    if (typeof (schemaObj.items as Record<string, unknown>).$ref === 'string') {
      const refResolved = resolveJsonPointer(root, (schemaObj.items as Record<string, unknown>).$ref as string, new Set(visited));
      items = (refResolved as Record<string, unknown>) || (schemaObj.items as Record<string, unknown>);
    } else {
      items = schemaObj.items as Record<string, unknown>;
    }
  }

  return {
    type,
    properties,
    required,
    description,
    items,
    raw: schemaObj,
  };
}
