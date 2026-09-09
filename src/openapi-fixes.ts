import {
  extendZodWithOpenApi,
  getRefId,
  type OpenAPIRegistry,
} from '@asteasolutions/zod-to-openapi';
import {
  extractZodPattern,
  getRecordValueType,
  getZodObjectShape,
  isPassthroughObject,
  isStructurallyNullable,
  unwrapToArrayElement,
  unwrapToInner,
} from './zod-introspection.js';

/**
 * Post-processing applied to everything `@asteasolutions/zod-to-openapi`
 * generates — whether it came from a `createZodDto()` class (via
 * `patchNestSwagger`) or from a Standard Schema attached with NestJS 12's
 * `@Body({ schema })` (via `createStandardSchemaConverter`).
 */

// ---------------------------------------------------------------------------
// Spurious nullable fix for z.coerce.* types
// ---------------------------------------------------------------------------

/**
 * Walks the registry definitions and strips `nullable: true` from generated
 * component schema properties that are NOT structurally nullable in the
 * original Zod schema.
 *
 * This is needed because `@asteasolutions/zod-to-openapi` uses
 * `schema.safeParse(null).success` to detect nullability — which returns
 * `true` for all `z.coerce.*` types (e.g. `new Date(null)` → epoch).
 */
export function fixGeneratedSchemas(registry: OpenAPIRegistry, schemas: Record<string, any>): void {
  // Collect ALL named Zod schemas — including auto-discovered ones nested
  // inside registered schemas (e.g. UserSchema.openapi('User') referenced
  // from UserDto). The registry only contains top-level registrations,
  // but the OpenAPI generator auto-discovers nested .openapi() schemas.
  const zodSchemaMap = collectNamedZodSchemas(registry);

  for (const [refId, zodSchema] of zodSchemaMap) {
    const componentSchema = schemas[refId];
    if (!componentSchema) continue;
    fixRootFacets(zodSchema, componentSchema);
    fixSchemaRecursive(zodSchema, componentSchema);
  }
}

/**
 * Applies the `nullable` / `pattern` fixes to the *root* of a generated schema.
 *
 * `fixSchemaRecursive` only ever looks at object *properties*, so a scalar root
 * — such as the schema of a `@Param('id', { schema: z.string().uuid() })`
 * parameter, which `createStandardSchemaConverter` inlines — would otherwise
 * keep a spurious `nullable` and never gain its format's regex `pattern`.
 *
 * Deliberately not called from inside `fixSchemaRecursive`: there the parent
 * already evaluated `nullable` against the *wrapped* field schema, while the
 * recursion receives the unwrapped inner one, so re-checking would drop a
 * legitimate `nullable: true`.
 */
function fixRootFacets(zodSchema: any, openApiSchema: any): void {
  if (!openApiSchema || typeof openApiSchema !== 'object') return;

  if (openApiSchema.nullable && !isStructurallyNullable(zodSchema)) {
    delete openApiSchema.nullable;
  }

  if (openApiSchema.format && !openApiSchema.pattern) {
    const pattern = extractZodPattern(zodSchema);
    if (pattern) openApiSchema.pattern = pattern;
  }
}

/**
 * Recursively walks registered Zod schemas and collects ALL named schemas
 * (those with `.openapi('Name')`) into a Map<refId, zodSchema>.
 */
function collectNamedZodSchemas(registry: OpenAPIRegistry): Map<string, any> {
  const map = new Map<string, any>();
  for (const def of registry.definitions) {
    if (def.type !== 'schema') continue;
    walkZodTree(def.schema, map);
  }
  return map;
}

function walkZodTree(zodSchema: any, map: Map<string, any>): void {
  if (!zodSchema) return;

  const refId = getRefId(zodSchema as any);
  if (refId) {
    if (map.has(refId)) return; // already visited — prevents infinite loops
    map.set(refId, zodSchema);
  }

  // Walk object shape
  const inner = unwrapToInner(zodSchema);
  const shape = inner?._zod?.def?.shape ?? inner?.shape;
  if (shape && typeof shape === 'object') {
    for (const field of Object.values(shape) as any[]) {
      const fieldInner = unwrapToInner(field);
      walkZodTree(fieldInner, map);
      // Also check array elements
      const element = fieldInner?._zod?.def?.element ?? fieldInner?.element;
      if (element) walkZodTree(element, map);
    }
  }

  // Walk discriminatedUnion / union options
  const options = inner?._zod?.def?.options;
  if (Array.isArray(options)) {
    for (const opt of options) {
      walkZodTree(opt, map);
    }
  }
}

/**
 * Recursively walks a generated OpenAPI schema alongside its source Zod schema:
 * - Strips spurious `nullable: true` from z.coerce.* types
 * - Enriches known `format` values with their regex `pattern`
 * - Strips spurious `nullable` from additionalProperties on passthrough/record schemas
 */
function fixSchemaRecursive(zodSchema: any, openApiSchema: any): void {
  // Fix additionalProperties at the root schema level (for .passthrough() / z.record())
  if (
    openApiSchema?.additionalProperties &&
    typeof openApiSchema.additionalProperties === 'object' &&
    openApiSchema.additionalProperties.nullable
  ) {
    const recordValueZod = getRecordValueType(zodSchema);
    if (recordValueZod) {
      if (!isStructurallyNullable(recordValueZod))
        delete openApiSchema.additionalProperties.nullable;
    } else if (isPassthroughObject(zodSchema)) {
      delete openApiSchema.additionalProperties.nullable;
    }
  }
  const shape = getZodObjectShape(zodSchema);
  if (!shape || !openApiSchema?.properties) return;

  for (const [key, prop] of Object.entries(openApiSchema.properties as Record<string, any>)) {
    const zodField = shape[key];
    if (!zodField) continue;

    // Fix spurious nullable
    if (prop.nullable && !isStructurallyNullable(zodField)) {
      delete prop.nullable;
    }

    // Enrich format with regex pattern from Zod checks
    if (prop.format && !prop.pattern) {
      const pattern = extractZodPattern(zodField);
      if (pattern) prop.pattern = pattern;
    }

    // Fix additionalProperties (z.record value type or .passthrough())
    if (
      prop.additionalProperties &&
      typeof prop.additionalProperties === 'object' &&
      prop.additionalProperties.nullable
    ) {
      const recordValueZod = getRecordValueType(zodField);
      if (recordValueZod) {
        // z.record(key, value) — check if value type is structurally nullable
        if (!isStructurallyNullable(recordValueZod)) {
          delete prop.additionalProperties.nullable;
        }
      } else if (isPassthroughObject(zodField)) {
        // .passthrough() — additionalProperties accepts anything, nullable is spurious
        delete prop.additionalProperties.nullable;
      }
    }

    // Recurse into nested inline objects
    if (prop.type === 'object' && prop.properties) {
      const innerZod = unwrapToInner(zodField);
      if (innerZod) fixSchemaRecursive(innerZod, prop);
    }

    // Recurse into array items
    if (prop.type === 'array' && prop.items) {
      const innerZod = unwrapToArrayElement(zodField);
      if (innerZod) {
        if (prop.items.properties) {
          fixSchemaRecursive(innerZod, prop.items);
        }
        if (prop.items.nullable && !isStructurallyNullable(innerZod)) {
          delete prop.items.nullable;
        }
        if (prop.items.format && !prop.items.pattern) {
          const pattern = extractZodPattern(innerZod);
          if (pattern) prop.items.pattern = pattern;
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// additionalProperties: { nullable: true } global strip
// ---------------------------------------------------------------------------

/**
 * Global pass: strips `additionalProperties: { nullable: true }` from anywhere
 * in the schema tree — including inline union variants, deeply nested objects,
 * and array items that `fixSchemaRecursive` can't reach without a parallel Zod tree.
 *
 * When `additionalProperties` contains ONLY `{ nullable: true }` (no type, no
 * other constraints), it always comes from zod-to-openapi's `safeParse(null)`
 * check on `.passthrough()` / `z.unknown()` values. Stripping `nullable` is
 * safe because `unknown` already includes `null` semantically.
 */
export function stripAdditionalPropsNullable(schemas: Record<string, any>): void {
  for (const schema of Object.values(schemas)) {
    walkAndStrip(schema);
  }
}

function walkAndStrip(obj: any): void {
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    for (const item of obj) walkAndStrip(item);
    return;
  }
  // Check this object's additionalProperties
  if (
    obj.additionalProperties &&
    typeof obj.additionalProperties === 'object' &&
    obj.additionalProperties.nullable
  ) {
    const keys = Object.keys(obj.additionalProperties);
    if (keys.length === 1 && keys[0] === 'nullable') {
      delete obj.additionalProperties.nullable;
    }
  }
  // Recurse into all object values
  for (const value of Object.values(obj)) {
    walkAndStrip(value);
  }
}

// ---------------------------------------------------------------------------
// `.openapi()` availability across Zod copies
// ---------------------------------------------------------------------------

/**
 * Ensure `schema.openapi()` is callable. `extendZodWithOpenApi` patches a single
 * Zod copy's `ZodType.prototype`; a schema built against a *different* Zod copy
 * (ESM vs CJS, or a duplicated transitive dependency) won't inherit it, so calling
 * `.openapi()` during generation throws. Walk to that schema's base prototype and
 * extend it in place. No-op when the schema is already extended.
 */
export function ensureOpenapiExtension(schema: unknown): void {
  if (!schema || typeof (schema as { openapi?: unknown }).openapi === 'function') {
    return;
  }
  // Climb to the top-most non-Object prototype (the Zod base class prototype);
  // adding `.openapi` there makes it resolvable for every schema of that copy.
  let proto = Object.getPrototypeOf(schema);
  while (
    proto &&
    Object.getPrototypeOf(proto) &&
    Object.getPrototypeOf(proto) !== Object.prototype
  ) {
    proto = Object.getPrototypeOf(proto);
  }
  if (proto && typeof (proto as { openapi?: unknown }).openapi !== 'function') {
    try {
      extendZodWithOpenApi({ ZodType: { prototype: proto } } as never);
    } catch {
      // Best-effort — the try/catch around registry.register() is the real safety net.
    }
  }
}
