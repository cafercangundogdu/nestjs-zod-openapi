import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { getRefId, OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import { INestApplication } from '@nestjs/common';
import { SwaggerDocumentOptions } from '@nestjs/swagger';

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

// We monkey-patch `@nestjs/swagger` internals at runtime. To stay safe across
// versions we (a) validate the patch targets exist before touching them, and
// (b) stash the pristine originals under symbols so repeated calls re-bind a
// fresh registry without growing a wrapper chain (HMR / multiple bootstraps).
const ORIGINAL_EXPLORE_MODEL_SCHEMA = Symbol.for(
  '@cafercangundogdu/nestjs-zod-openapi.originalExploreModelSchema',
);
const ORIGINAL_SCAN_APPLICATION = Symbol.for(
  '@cafercangundogdu/nestjs-zod-openapi.originalScanApplication',
);

/** The range of `@nestjs/swagger` major versions this patch is verified against. */
const SUPPORTED_SWAGGER_MAJORS = [11];

function assertPatchTarget(condition: unknown, detail: string): asserts condition {
  if (!condition) {
    throw new Error(
      `[nestjs-zod-openapi] Cannot patch @nestjs/swagger: ${detail}. ` +
        'This usually means the installed @nestjs/swagger version is not supported ' +
        `(verified majors: ${SUPPORTED_SWAGGER_MAJORS.join(', ')}). ` +
        'Please open an issue at https://github.com/cafercangundogdu/nestjs-zod-openapi/issues.',
    );
  }
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
  const appRequire = createRequire(require.main?.filename ?? `${process.cwd()}/package.json`);
  // Since @nestjs/swagger@11.4.3 the package ships a restrictive `exports` map that blocks deep
  // subpath imports (`@nestjs/swagger/dist/...`) under Node's native loader. The
  // `SchemaObjectFactory` / `SwaggerScanner` classes we patch are internal (not part of the
  // public API), so we resolve the package root via its `package.json` (an allowed export) and
  // require the internal files by absolute path — absolute paths bypass `exports` enforcement.
  let swaggerRoot: string;
  let schemaObjectFactoryModule: any;
  let swaggerScannerModule: any;
  try {
    swaggerRoot = dirname(appRequire.resolve('@nestjs/swagger/package.json'));
    schemaObjectFactoryModule = appRequire(
      join(swaggerRoot, 'dist/services/schema-object-factory.js'),
    );
    swaggerScannerModule = appRequire(join(swaggerRoot, 'dist/swagger-scanner.js'));
  } catch (cause) {
    const error = new Error(
      '[nestjs-zod-openapi] Failed to resolve @nestjs/swagger internals. Make sure ' +
        '@nestjs/swagger is installed in your app and matches a supported major version ' +
        `(${SUPPORTED_SWAGGER_MAJORS.join(', ')}).`,
    );
    (error as any).cause = cause;
    throw error;
  }

  // Best-effort major-version check. We don't hard-fail on an unknown major (a future
  // release may still be structurally compatible) — the structural assertions below are
  // the real safety net — but we warn so surprises are diagnosable.
  warnOnUnsupportedVersion(appRequire, swaggerRoot);

  const registry = new OpenAPIRegistry();

  // -----------------------------------------------------------------------
  // 1. Override `exploreModelSchema`
  // -----------------------------------------------------------------------
  const SchemaObjectFactory = schemaObjectFactoryModule.SchemaObjectFactory;
  assertPatchTarget(
    typeof SchemaObjectFactory === 'function',
    'SchemaObjectFactory export not found in dist/services/schema-object-factory.js',
  );
  assertPatchTarget(
    typeof SchemaObjectFactory.prototype.exploreModelSchema === 'function',
    'SchemaObjectFactory.prototype.exploreModelSchema is not a function',
  );

  // Capture the pristine original ONCE (stashed under a symbol). On re-invocation we
  // re-read the stash rather than the currently-installed function, so we never wrap our
  // own patch — the chain stays one level deep no matter how many times this runs.
  const originalExploreModelSchema: (...args: any[]) => string =
    SchemaObjectFactory.prototype[ORIGINAL_EXPLORE_MODEL_SCHEMA] ??
    SchemaObjectFactory.prototype.exploreModelSchema;
  SchemaObjectFactory.prototype[ORIGINAL_EXPLORE_MODEL_SCHEMA] = originalExploreModelSchema;

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
  assertPatchTarget(
    typeof SwaggerScanner === 'function',
    'SwaggerScanner export not found in dist/swagger-scanner.js',
  );
  assertPatchTarget(
    typeof SwaggerScanner.prototype.scanApplication === 'function',
    'SwaggerScanner.prototype.scanApplication is not a function',
  );

  const originalScanApplication: (...args: any[]) => any =
    SwaggerScanner.prototype[ORIGINAL_SCAN_APPLICATION] ?? SwaggerScanner.prototype.scanApplication;
  SwaggerScanner.prototype[ORIGINAL_SCAN_APPLICATION] = originalScanApplication;

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

/**
 * Reads the installed `@nestjs/swagger` version and warns (once-ish, via console) when its
 * major is outside the verified set. Never throws — resolution/parse failures are ignored so
 * a missing `version` field can't break bootstrap.
 */
function warnOnUnsupportedVersion(appRequire: NodeRequire, swaggerRoot: string): void {
  try {
    const pkg = appRequire(join(swaggerRoot, 'package.json'));
    const version: string | undefined = pkg?.version;
    const major = version ? Number.parseInt(version.split('.')[0], 10) : NaN;
    if (!Number.isNaN(major) && !SUPPORTED_SWAGGER_MAJORS.includes(major)) {
      console.warn(
        `[nestjs-zod-openapi] Installed @nestjs/swagger@${version} has an unverified major ` +
          `version (verified: ${SUPPORTED_SWAGGER_MAJORS.join(', ')}). Patching will proceed, ` +
          'but schema generation may behave unexpectedly.',
      );
    }
  } catch {
    // Version probe is best-effort; structural assertions guard correctness.
  }
}

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
