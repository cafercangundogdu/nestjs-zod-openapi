import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import type { INestApplication } from '@nestjs/common';
import type { SwaggerDocumentOptions } from '@nestjs/swagger';
import {
  ensureOpenapiExtension,
  fixGeneratedSchemas,
  stripAdditionalPropsNullable,
} from './openapi-fixes.js';
import {
  createStandardSchemaConverter,
  type StandardSchemaConverter,
} from './standard-schema-converter.js';

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

  /**
   * Converter for Standard Schema objects attached with NestJS 12's
   * `@Body({ schema })`, `@Query({ schema })`, `@Param(name, { schema })` and
   * `@ApiResponse({ standardSchema })`. It is injected as the
   * `standardSchemaConverter` option of `SwaggerModule.createDocument()` unless
   * the application already passes one there. Set to `false` to leave
   * `@nestjs/swagger`'s built-in conversion in place. Has no effect on
   * `@nestjs/swagger` 11, which does not know about Standard Schema.
   *
   * @default createStandardSchemaConverter()
   */
  standardSchemaConverter?: StandardSchemaConverter | false;
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
const ORIGINAL_GET_SCHEMA_OVERRIDE = Symbol.for(
  '@cafercangundogdu/nestjs-zod-openapi.originalGetSchemaOverride',
);

/** The range of `@nestjs/swagger` major versions this patch is verified against. */
const SUPPORTED_SWAGGER_MAJORS = [11, 12];

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
 *    OpenAPI document. On `@nestjs/swagger` 12 it also injects
 *    `createStandardSchemaConverter()` into the document options so schemas
 *    attached with `@Body({ schema })` & co. are rendered the same way.
 *
 * 3. (`@nestjs/swagger` 12 only) Wraps `SchemaObjectFactory.prototype.getSchemaOverride`
 *    so an unnamed `@Query({ schema })` / `@Param({ schema })` whose schema is a
 *    named (`.openapi('Name')`) object still expands into individual parameters.
 */
export function patchNestSwagger(options: PatchNestSwaggerOptions = {}): void {
  const { schemasSort = 'default', standardSchemaConverter = createStandardSchemaConverter() } =
    options;

  // Resolve @nestjs/swagger internals from the **consumer's** node_modules,
  // not this library's. In pnpm/monorepo setups the library may have its own
  // copy of @nestjs/swagger that differs from the one the NestJS app uses.
  // `createRequire` anchored at the app's entry point guarantees we patch the
  // same prototype instances that SwaggerModule will use at runtime.
  // `require.main` only exists in CJS; the ESM build falls back to the entry
  // script (process.argv[1]) and then to the working directory.
  const appEntry =
    (typeof require === 'function' ? require.main?.filename : undefined) ??
    process.argv[1] ??
    `${process.cwd()}/package.json`;
  const appRequire = createRequire(appEntry);
  // Since @nestjs/swagger@11.4.3 the package ships a restrictive `exports` map that blocks deep
  // subpath imports (`@nestjs/swagger/dist/...`) under Node's native loader. The
  // `SchemaObjectFactory` / `SwaggerScanner` classes we patch are internal (not part of the
  // public API), so we resolve the package root via its `package.json` (an allowed export) and
  // require the internal files by absolute path — absolute paths bypass `exports` enforcement.
  // @nestjs/swagger 12 ships these files as ESM; `require()` still returns their namespace
  // (Node's `require(esm)`, available on every Node version NestJS 12 supports).
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

    // Pre-built schemas imported from another package can come from a *different*
    // Zod copy (ESM/CJS dual-package, or a duplicated transitive dependency) that
    // `initZodOpenApi` never extended — so they lack `.openapi()`. Extend that
    // copy's `ZodType` in place so generation still works for them.
    ensureOpenapiExtension(type.zodSchema);

    // Register the Zod schema with the OpenAPI registry so that
    // `OpenApiGeneratorV3` can convert it to a proper SchemaObject including
    // discriminatedUnion -> oneOf, union -> oneOf, nested $ref, etc. A schema that
    // still can't be registered is skipped (with a warning) rather than aborting
    // the whole OpenAPI document.
    try {
      registry.register(schemaName, type.zodSchema);
    } catch (err) {
      console.warn(
        `[nestjs-zod-openapi] Skipping schema "${schemaName}" in OpenAPI generation: ${
          (err as Error)?.message ?? String(err)
        }`,
      );
    }

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
    swaggerOptions?: SwaggerDocumentOptions,
  ) {
    const openAPIObject = originalScanApplication.call(
      this,
      app,
      withStandardSchemaConverter(swaggerOptions, standardSchemaConverter),
    );

    // Generate OpenAPI component schemas from all registered Zod schemas.
    const generator = new OpenApiGeneratorV3(registry.definitions);
    const generated = generator.generateComponents();

    // Merge generated schemas with any schemas the default scanner produced
    // (e.g. from `@ApiProperty()` decorators on non-Zod classes, or from the
    // Standard Schema converter).
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

  // -----------------------------------------------------------------------
  // 3. (@nestjs/swagger 12+) Resolve `$ref` overrides for unnamed parameters
  // -----------------------------------------------------------------------
  // `SchemaObjectFactory.getSchemaOverride` runs the `standardSchemaConverter` for a
  // parameter. NestJS then expands an *unnamed* query/path/header parameter into one
  // parameter per property — but only when the converted schema is an inline object.
  // `createStandardSchemaConverter()` returns a `$ref` for `.openapi('Name')` schemas,
  // so dereference it here for that case. Bodies and named parameters keep the `$ref`.
  // Absent on @nestjs/swagger 11 (no Standard Schema support) — nothing to do there.
  if (typeof SchemaObjectFactory.prototype.getSchemaOverride === 'function') {
    const originalGetSchemaOverride: (...args: any[]) => any =
      SchemaObjectFactory.prototype[ORIGINAL_GET_SCHEMA_OVERRIDE] ??
      SchemaObjectFactory.prototype.getSchemaOverride;
    SchemaObjectFactory.prototype[ORIGINAL_GET_SCHEMA_OVERRIDE] = originalGetSchemaOverride;

    SchemaObjectFactory.prototype.getSchemaOverride = function patchedGetSchemaOverride(
      this: any,
      param: any,
      schemas: Record<string, any>,
    ) {
      const override = originalGetSchemaOverride.call(this, param, schemas);
      if (typeof override?.$ref !== 'string' || param?.in === 'body' || param?.name) {
        return override;
      }
      const resolved = schemas?.[override.$ref.replace('#/components/schemas/', '')];
      return resolved?.type === 'object' && resolved.properties ? resolved : override;
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// `standardSchemaConverter` is widened to `unknown` so this compiles on both
// @nestjs/swagger 11 (where `SwaggerDocumentOptions` has no such key) and 12
// (where its converter type is structurally looser than ours — `schema: unknown`).
type SwaggerDocumentOptionsWithConverter = Omit<
  SwaggerDocumentOptions,
  'standardSchemaConverter'
> & {
  standardSchemaConverter?: unknown;
};

/**
 * Adds our Standard Schema converter to the `createDocument()` options unless the
 * app supplied its own (or injection was disabled). `@nestjs/swagger` 11 simply
 * ignores the extra option.
 */
function withStandardSchemaConverter(
  options: SwaggerDocumentOptionsWithConverter | undefined,
  converter: StandardSchemaConverter | false,
): SwaggerDocumentOptionsWithConverter {
  const base = options ?? {};
  if (converter === false || base.standardSchemaConverter) {
    return base;
  }
  return { ...base, standardSchemaConverter: converter };
}

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
