import { getRefId, OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import type { z } from 'zod';
import {
  extractZodPattern,
  getZodObjectShape,
  isStructurallyNullable,
} from './zod-introspection.js';

/**
 * Resolves the instance type for `new ()`.
 *
 * TypeScript's `class X extends Base` requires Base's constructor return
 * type to be "an object type with statically known members" — union types
 * are rejected (TS2509).
 *
 * For z.object() schemas: `{ [K in keyof O]: O[K] }` preserves all typed
 * properties (same as the original output type).
 *
 * For z.union() / z.discriminatedUnion(): the mapped type collapses the
 * union to only the shared keys (e.g. `{ type: "a" | "b" }` for a
 * discriminated union), which TypeScript accepts as an extends target.
 */
type DtoInstance<T extends z.ZodType> =
  z.output<T> extends Record<string, unknown>
    ? { [K in keyof z.output<T>]: z.output<T>[K] }
    : object;

/**
 * Marker interface for classes created by `createZodDto`.
 */
export interface ZodDtoStatic<T extends z.ZodType = z.ZodType> {
  new (): DtoInstance<T>;
  schema: T;
  zodSchema: T;
  isZodDto: true;
  create(input: unknown): z.output<T>;
  _OPENAPI_METADATA_FACTORY(): Record<string, unknown>;
}

/**
 * Creates a NestJS-compatible DTO class backed by a Zod schema.
 *
 * Works with z.object(), z.union(), z.discriminatedUnion(), and any other Zod type.
 *
 * The returned class exposes:
 * - `static schema` / `static zodSchema` — the original Zod schema
 * - `static isZodDto` — marker for pipe/guard detection
 * - `static create(input)` — shorthand for `schema.parse(input)`
 * - `static _OPENAPI_METADATA_FACTORY()` — for @nestjs/swagger compatibility
 */
export function createZodDto<T extends z.ZodType>(schema: T): ZodDtoStatic<T> {
  let cachedMetadata: Record<string, unknown> | null = null;

  class AugmentedZodDto {
    static isZodDto = true as const;
    static schema = schema;
    static zodSchema = schema;

    static create(input: unknown) {
      return schema.parse(input);
    }

    // NestJS Swagger calls this to discover property metadata.
    // For z.object() schemas, we generate per-property metadata so that
    // @Query() DTOs appear as individual query parameters in Swagger.
    // For non-object schemas (union, discriminatedUnion, etc.), we return {}
    // and let patchNestSwagger handle schema generation via the OpenAPI registry.
    static _OPENAPI_METADATA_FACTORY(): Record<string, unknown> {
      if (cachedMetadata === null) {
        cachedMetadata = buildSwaggerMetadata(schema);
      }
      return cachedMetadata;
    }
  }

  // Set the class name from the .openapi('Name') refId.
  // This determines the Swagger model name in components/schemas.
  const refId = getRefId(schema as any);
  if (refId) {
    Object.defineProperty(AugmentedZodDto, 'name', {
      value: refId,
      writable: false,
    });
  }

  return AugmentedZodDto as unknown as ZodDtoStatic<T>;
}

/**
 * Type guard: returns `true` when the value is a class created by `createZodDto`.
 */
export function isZodDto(metatype: unknown): metatype is ZodDtoStatic {
  return Boolean(
    metatype &&
      (typeof metatype === 'object' || typeof metatype === 'function') &&
      'isZodDto' in metatype &&
      (metatype as Record<string, unknown>).isZodDto === true,
  );
}

// ---------------------------------------------------------------------------
// Swagger metadata generation
// ---------------------------------------------------------------------------

/**
 * Generates NestJS Swagger property metadata from a Zod schema.
 *
 * Uses `@asteasolutions/zod-to-openapi` to generate the OpenAPI JSON Schema,
 * then converts each property to the `@ApiProperty()`-compatible format that
 * `@nestjs/swagger`'s `_OPENAPI_METADATA_FACTORY` expects.
 *
 * Only produces metadata for `z.object()` schemas. For unions, discriminated
 * unions, and other non-object schemas, returns `{}` (these are handled
 * entirely by `patchNestSwagger`).
 */
function buildSwaggerMetadata(zodSchema: z.ZodType): Record<string, unknown> {
  try {
    const registry = new OpenAPIRegistry();
    registry.register('__ZodDtoMeta__', zodSchema as any);
    const generator = new OpenApiGeneratorV3(registry.definitions);
    const result = generator.generateComponents();
    const allSchemas = (result.components?.schemas ?? {}) as Record<string, Record<string, any>>;
    const rootSchema = allSchemas.__ZodDtoMeta__;

    if (rootSchema?.type !== 'object' || !rootSchema.properties) {
      return {};
    }

    // Build structural overrides from the Zod schema:
    // - nullableKeys: which properties are structurally .nullable()
    // - patternMap: regex patterns from Zod checks (e.g. .uuid(), .email())
    const nullableKeys = buildNullableKeySet(zodSchema);
    const patternMap = buildPatternMap(zodSchema);

    const requiredSet = new Set<string>((rootSchema.required as string[]) ?? []);
    const metadata: Record<string, unknown> = {};

    for (const [key, propSchema] of Object.entries(
      rootSchema.properties as Record<string, Record<string, any>>,
    )) {
      metadata[key] = openApiToSwaggerMeta(
        propSchema,
        requiredSet.has(key),
        allSchemas,
        nullableKeys?.has(key),
        patternMap?.get(key),
      );
    }

    return metadata;
  } catch {
    return {};
  }
}

/**
 * For a `z.object()` schema, returns a Set of property keys whose Zod
 * definition is structurally nullable.  Returns `undefined` for non-object
 * schemas (no shape to inspect).
 */
function buildNullableKeySet(zodSchema: z.ZodType): Set<string> | undefined {
  const shape = getZodObjectShape(zodSchema);
  if (!shape) return undefined;
  const keys = new Set<string>();
  for (const [key, propSchema] of Object.entries(shape)) {
    if (isStructurallyNullable(propSchema)) {
      keys.add(key);
    }
  }
  return keys;
}

/**
 * For a `z.object()` schema, returns a Map of property keys to their Zod
 * check regex patterns (e.g. `.uuid()` → UUID regex, `.email()` → email regex).
 * Returns `undefined` for non-object schemas.
 */
function buildPatternMap(zodSchema: z.ZodType): Map<string, string> | undefined {
  const shape = getZodObjectShape(zodSchema);
  if (!shape) return undefined;

  const map = new Map<string, string>();
  for (const [key, propSchema] of Object.entries(shape)) {
    const pattern = extractZodPattern(propSchema);
    if (pattern) map.set(key, pattern);
  }
  return map;
}

/**
 * Creates a lazy type function recognized by `@nestjs/swagger`'s `isLazyTypeFunc`.
 *
 * NestJS Swagger v11 and v12 detect lazy type wrappers via `fn.name == 'type'`.
 * V8 only assigns this name when the function is created as a value in an
 * object literal with key `type`.  Arrow functions created via assignment
 * (e.g., `meta.type = () => String`) get an empty name instead.
 *
 * This helper ensures the function has the correct `.name` for NestJS to unwrap.
 */
// biome-ignore lint/complexity/noBannedTypes: NestJS DTO `type` thunks resolve to arbitrary constructors/primitives (String, Number, a class, …); the generic `Function` is the intended shape — a narrower signature would reject valid NestJS type references.
function lazyType(ctor: Function): () => Function {
  // V8 assigns name 'type' to the arrow function because it's the value of
  // the property key 'type' in the object literal. We extract and return it.
  return { type: () => ctor }.type;
}

/**
 * Converts a single OpenAPI 3.0 Schema Object to the metadata format
 * expected by `@nestjs/swagger`'s `@ApiProperty()` / `_OPENAPI_METADATA_FACTORY`.
 */
function openApiToSwaggerMeta(
  prop: Record<string, any>,
  isRequired: boolean,
  allSchemas: Record<string, Record<string, any>>,
  /** When provided, overrides the nullable flag from the OpenAPI schema. */
  isActuallyNullable?: boolean,
  /** When provided, adds `pattern` from the original Zod check regex. */
  zodPattern?: string,
): Record<string, any> {
  const meta: Record<string, any> = { required: isRequired };

  // $ref → resolve from generated schemas (handles named enums, nested objects)
  if (prop.$ref) {
    const refName = (prop.$ref as string).replace('#/components/schemas/', '');
    const resolved = allSchemas[refName];
    if (resolved) {
      return openApiToSwaggerMeta(resolved, isRequired, allSchemas, isActuallyNullable);
    }
    meta.type = lazyType(Object);
    return meta;
  }

  // Determine effective nullable: prefer the structural override from the Zod
  // schema when available; fall back to the OpenAPI schema's flag otherwise.
  const effectiveNullable = isActuallyNullable ?? prop.nullable ?? false;

  // nullable (OpenAPI 3.0 style)
  if (effectiveNullable) {
    meta.nullable = true;
  }

  // oneOf / anyOf — handle nullable wrappers and genuine unions
  if (prop.oneOf || prop.anyOf) {
    const variants: Record<string, any>[] = prop.oneOf ?? prop.anyOf;
    const nonNull = variants.filter((v) => v.type !== 'null');
    const hasNull = variants.some((v) => v.type === 'null');
    // Use structural override when available; otherwise trust the anyOf/oneOf null variant
    const unionNullable = isActuallyNullable ?? hasNull;
    if (unionNullable) meta.nullable = true;
    if (nonNull.length === 1) {
      return {
        ...openApiToSwaggerMeta(nonNull[0], isRequired, allSchemas, isActuallyNullable),
        nullable: unionNullable,
      };
    }
    meta.type = lazyType(Object);
    return meta;
  }

  // allOf with single item → unwrap
  if (prop.allOf?.length === 1) {
    return openApiToSwaggerMeta(prop.allOf[0], isRequired, allSchemas);
  }

  // Constraints
  if (prop.default !== undefined) {
    meta.default = prop.default;
    meta.required = false;
  }
  if (prop.description) meta.description = prop.description;
  if (prop.format) meta.format = prop.format;
  if (prop.enum) meta.enum = prop.enum;
  if (prop.minimum !== undefined) meta.minimum = prop.minimum;
  if (prop.maximum !== undefined) meta.maximum = prop.maximum;
  if (prop.exclusiveMinimum !== undefined) meta.exclusiveMinimum = prop.exclusiveMinimum;
  if (prop.exclusiveMaximum !== undefined) meta.exclusiveMaximum = prop.exclusiveMaximum;
  if (prop.minLength !== undefined) meta.minLength = prop.minLength;
  if (prop.maxLength !== undefined) meta.maxLength = prop.maxLength;
  // Pattern: prefer the one from the Zod schema check (zodPattern), then from
  // OpenAPI output, since zod-to-openapi drops the regex for format-based checks.
  if (zodPattern) meta.pattern = zodPattern;
  else if (prop.pattern) meta.pattern = prop.pattern;

  // Type mapping — all type functions use lazyType() to ensure fn.name == 'type'
  switch (prop.type) {
    case 'string':
      meta.type = lazyType(String);
      break;
    case 'number':
      meta.type = lazyType(Number);
      break;
    case 'integer':
      meta.type = lazyType(Number);
      if (!meta.format) meta.format = 'int64';
      break;
    case 'boolean':
      meta.type = lazyType(Boolean);
      break;
    case 'array': {
      meta.isArray = true;
      if (prop.items) {
        const itemMeta = openApiToSwaggerMeta(prop.items, true, allSchemas);
        const itemType = typeof itemMeta.type === 'function' ? itemMeta.type() : Object;
        // Pass as [Type] so getTypeIsArrayTuple recognizes the array wrapper
        // even after lazy type unwrapping (which ignores the existing isArray flag).
        meta.type = { type: () => [itemType] }.type;
      } else {
        meta.type = { type: () => [Object] }.type;
      }
      break;
    }
    default:
      meta.type = lazyType(Object);
  }

  return meta;
}
