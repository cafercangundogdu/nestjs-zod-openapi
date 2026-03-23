import { getRefId, OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import { INestApplication } from '@nestjs/common';
import { SwaggerDocumentOptions } from '@nestjs/swagger';
import { createRequire } from 'module';

export interface PatchNestSwaggerOptions {
  /**
   * Control how schemas in `components/schemas` are sorted.
   * - `'default'`: keep insertion order
   * - `'alpha'`: sort by key using `<` / `>`
   * - `'localeCompare'`: sort by key using `String.prototype.localeCompare`
   *
   * @default 'default'
   */
  schemasSort?: 'default' | 'alpha' | 'localeCompare';
}

/**
 * Patches `@nestjs/swagger` to understand Zod schemas attached to DTO classes
 * created by `createZodDto()`.
 *
 * Call this **once** at application bootstrap, **before** `SwaggerModule.createDocument()`.
 *
 * How it works:
 * 1. Overrides `SchemaObjectFactory.prototype.exploreModelSchema` so that when
 *    a DTO class with a static `zodSchema` property is encountered, it is
 *    registered in an `OpenAPIRegistry` instead of going through the default
 *    `class-validator` / `reflect-metadata` metadata path.
 *
 * 2. Overrides `SwaggerScanner.prototype.scanApplication` so that after the
 *    normal scan completes, the Zod-to-OpenAPI generator runs over the
 *    registry and the resulting component schemas are merged into the final
 *    OpenAPI document.
 */
export function patchNestSwagger(options: PatchNestSwaggerOptions = {}): void {
  const { schemasSort = 'default' } = options;

  // Resolve @nestjs/swagger internals from the **consumer's** node_modules,
  // not this library's. In pnpm/monorepo setups the library may have its own
  // copy of @nestjs/swagger that differs from the one the NestJS app uses.
  // `createRequire` anchored at the app's entry point guarantees we patch the
  // same prototype instances that SwaggerModule will use at runtime.
  const appRequire = createRequire(require.main?.filename ?? process.cwd() + '/package.json');
  const schemaObjectFactoryModule = appRequire(
    '@nestjs/swagger/dist/services/schema-object-factory',
  );
  const swaggerScannerModule = appRequire('@nestjs/swagger/dist/swagger-scanner');

  const registry = new OpenAPIRegistry();

  // -----------------------------------------------------------------------
  // 1. Override `exploreModelSchema`
  // -----------------------------------------------------------------------
  const SchemaObjectFactory = schemaObjectFactoryModule.SchemaObjectFactory;
  const originalExploreModelSchema = SchemaObjectFactory.prototype.exploreModelSchema;

  SchemaObjectFactory.prototype.exploreModelSchema = function patchedExploreModelSchema(
    this: any,
    type: any,
    schemas: Record<string, any>,
    schemaRefsStack: string[] = [],
  ): string {
    // Resolve lazy type wrappers used by @nestjs/swagger internally.
    if (this.isLazyTypeFunc(type)) {
      type = type();
    }

    // If the class does not carry a Zod schema, fall back to the original.
    if (!type.zodSchema) {
      return originalExploreModelSchema.call(this, type, schemas, schemaRefsStack);
    }

    const schemaName: string = type.name;

    // Register the Zod schema with the OpenAPI registry so that
    // `OpenApiGeneratorV3` can convert it to a proper SchemaObject including
    // discriminatedUnion -> oneOf, union -> oneOf, nested $ref, etc.
    registry.register(schemaName, type.zodSchema);

    return schemaName;
  };

  // -----------------------------------------------------------------------
  // 2. Override `scanApplication`
  // -----------------------------------------------------------------------
  const SwaggerScanner = swaggerScannerModule.SwaggerScanner;
  const originalScanApplication = SwaggerScanner.prototype.scanApplication;

  SwaggerScanner.prototype.scanApplication = function patchedScanApplication(
    this: any,
    app: INestApplication,
    swaggerOptions: SwaggerDocumentOptions,
  ) {
    const openAPIObject = originalScanApplication.call(this, app, swaggerOptions);

    // Generate OpenAPI component schemas from all registered Zod schemas.
    const generator = new OpenApiGeneratorV3(registry.definitions);
    const generated = generator.generateComponents();

    // Merge generated schemas with any schemas the default scanner produced
    // (e.g. from `@ApiProperty()` decorators on non-Zod classes).
    const mergedSchemas: Record<string, any> = {
      ...(openAPIObject.components?.schemas ?? {}),
      ...(generated.components?.schemas ?? {}),
    };

    // Post-process generated schemas:
    // - Strip spurious `nullable: true` from z.coerce.* types
    // - Enrich format fields with regex patterns from Zod checks
    fixGeneratedSchemas(registry, mergedSchemas);

    // Global pass: strip `additionalProperties: { nullable: true }` anywhere in
    // the schema tree.  zod-to-openapi adds this for .passthrough() / z.unknown()
    // values because safeParse(null) succeeds. When the only key is `nullable`,
    // it's always spurious — `unknown` already includes null semantically.
    stripAdditionalPropsNullable(mergedSchemas);

    // Optionally sort.
    const sorted = sortSchemas(mergedSchemas, schemasSort);

    openAPIObject.components = {
      ...(openAPIObject.components ?? {}),
      schemas: sorted,
    };

    return openAPIObject;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sortSchemas(
  schemas: Record<string, any>,
  mode: 'default' | 'alpha' | 'localeCompare',
): Record<string, any> {
  if (mode === 'default') {
    return schemas;
  }

  const comparator: (a: string, b: string) => number =
    mode === 'alpha'
      ? (a, b) => {
          if (a < b) return -1;
          if (a > b) return 1;
          return 0;
        }
      : (a, b) => a.localeCompare(b);

  const entries = Object.entries(schemas).sort(([a], [b]) => comparator(a, b));
  return Object.fromEntries(entries);
}

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
function fixGeneratedSchemas(registry: OpenAPIRegistry, schemas: Record<string, any>): void {
  // Collect ALL named Zod schemas — including auto-discovered ones nested
  // inside registered schemas (e.g. UserSchema.openapi('User') referenced
  // from UserDto). The registry only contains top-level registrations,
  // but the OpenAPI generator auto-discovers nested .openapi() schemas.
  const zodSchemaMap = collectNamedZodSchemas(registry);

  for (const [refId, zodSchema] of zodSchemaMap) {
    const componentSchema = schemas[refId];
    if (!componentSchema) continue;
    fixSchemaRecursive(zodSchema, componentSchema);
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

/**
 * Extracts the shape (Record<string, ZodType>) from a Zod object schema.
 * Returns `undefined` for non-object schemas.
 */
function getZodObjectShape(schema: any): Record<string, any> | undefined {
  const inner = unwrapToInner(schema);
  const shape = inner?._zod?.def?.shape ?? inner?.shape;
  if (shape && typeof shape === 'object') return shape;
  return undefined;
}

/**
 * Unwraps Zod modifier wrappers (optional, nullable, default, etc.)
 * to reach the inner schema.
 */
function unwrapToInner(schema: any): any {
  let s = schema;
  const wrappers = new Set([
    'optional',
    'nullable',
    'default',
    'prefault',
    'transform',
    'pipe',
    'catch',
    'readonly',
    'brand',
    'nonoptional',
  ]);
  while (s?._zod?.def) {
    const type: string | undefined = s._zod.def.type;
    if (type && wrappers.has(type) && s._zod.def.innerType) {
      s = s._zod.def.innerType;
      continue;
    }
    break;
  }
  return s;
}

/**
 * Unwraps a Zod schema to find the array element type.
 * Handles `z.array(inner)` and `z.array(inner).optional()` etc.
 */
function unwrapToArrayElement(schema: any): any {
  const inner = unwrapToInner(schema);
  // ZodArray: element is in _zod.def.element or .element
  return inner?._zod?.def?.element ?? inner?.element ?? undefined;
}

/**
 * Determines whether a Zod schema is structurally nullable — i.e., explicitly
 * wrapped in `.nullable()` somewhere in its modifier chain.
 */
/**
 * Extracts the regex pattern from a Zod schema's format checks (e.g. .uuid(), .email()).
 * Zod stores the regex in `_zod.def.checks[].def.pattern` as a RegExp.
 */
/**
 * Extracts the value type from a Zod record schema (z.record(keyType, valueType)).
 * Unwraps modifiers to reach the ZodRecord, then returns the valueType.
 */
/**
 * Checks if a Zod schema is an object with `.passthrough()` applied.
 * In Zod 4, `.passthrough()` sets `_zod.def.catchall` or similar flag.
 */
function isPassthroughObject(schema: any): boolean {
  const inner = unwrapToInner(schema);
  if (inner?._zod?.def?.type !== 'object') return false;
  // Zod 4: .passthrough() sets catchall to z.unknown()
  // .strict() sets catchall to z.never()
  // No modifier: catchall is undefined
  const catchall = inner._zod.def.catchall;
  const catchallType = catchall?._zod?.def?.type;
  return catchallType === 'unknown' || catchallType === 'any';
}

function getRecordValueType(schema: any): any {
  const inner = unwrapToInner(schema);
  return inner?._zod?.def?.valueType ?? undefined;
}

function extractZodPattern(schema: any): string | undefined {
  const inner = unwrapToInner(schema);
  const checks: any[] = inner?._zod?.def?.checks ?? [];
  for (const check of checks) {
    const pat = check?.def?.pattern;
    if (pat instanceof RegExp) return pat.source;
  }
  return undefined;
}

function isStructurallyNullable(schema: any): boolean {
  let s = schema;
  const passthrough = new Set([
    'optional',
    'default',
    'prefault',
    'transform',
    'pipe',
    'catch',
    'readonly',
    'brand',
    'nonoptional',
  ]);
  while (s?._zod?.def) {
    const type: string | undefined = s._zod.def.type;
    if (type === 'nullable') return true;
    if (type && passthrough.has(type) && s._zod.def.innerType) {
      s = s._zod.def.innerType;
      continue;
    }
    break;
  }
  return false;
}

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
function stripAdditionalPropsNullable(schemas: Record<string, any>): void {
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
