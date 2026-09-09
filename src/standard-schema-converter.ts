import { getRefId, OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import {
  ensureOpenapiExtension,
  fixGeneratedSchemas,
  stripAdditionalPropsNullable,
} from './openapi-fixes.js';
import { isZodSchema } from './zod-introspection.js';

/**
 * Result of converting one Standard Schema object into OpenAPI. Structurally
 * identical to `StandardSchemaConversionResult` from `@nestjs/swagger` 12, so
 * the converter can be passed straight to `SwaggerModule.createDocument()`.
 */
export interface StandardSchemaConversionResult {
  /** The schema (or `$ref`) to place at the parameter / request body / response. */
  schema: Record<string, unknown>;
  /** Named schemas to merge into `components/schemas`. */
  components?: Record<string, Record<string, unknown>>;
}

/**
 * Signature of `@nestjs/swagger` 12's `standardSchemaConverter` document option.
 * Declared here (rather than imported) so the library's type definitions keep
 * working against `@nestjs/swagger` 11, which has no such option.
 */
export type StandardSchemaConverter = (
  schema: unknown,
  options: { schemaType: 'input' | 'output' },
) => StandardSchemaConversionResult | undefined;

/**
 * Temporary ref id under which an unnamed schema is registered so that
 * `OpenApiGeneratorV3` produces an inline definition for it. Never leaks into
 * the document: the component is extracted and dropped before returning.
 */
const INLINE_REF_ID = '__NestZodOpenApiInline__';

/**
 * Creates a `standardSchemaConverter` for `SwaggerModule.createDocument()`
 * (NestJS 12+) that renders Zod schemas attached with `@Body({ schema })`,
 * `@Query({ schema })`, `@Param(name, { schema })` and
 * `@ApiResponse({ standardSchema })` through `@asteasolutions/zod-to-openapi`,
 * with the same post-processing this library applies to `createZodDto()` classes:
 *
 * - `.openapi('Name')` schemas become `components/schemas/Name` and are referenced via `$ref`
 *   (nested named schemas are emitted as components too); unnamed schemas are inlined
 * - `z.discriminatedUnion()` → `oneOf` + `discriminator`, `z.coerce.date()` → `string`/`date-time`
 * - spurious `nullable` on `z.coerce.*` is stripped, `format` checks gain their regex `pattern`
 *
 * Non-Zod schemas return `undefined`, which makes `@nestjs/swagger` fall back
 * to its built-in Standard JSON Schema conversion for them.
 *
 * `patchNestSwagger()` injects this converter automatically, so calling it
 * yourself is only needed when you use `@Body({ schema })` without the patch:
 *
 * @example
 * ```ts
 * SwaggerModule.createDocument(app, config, {
 *   standardSchemaConverter: createStandardSchemaConverter(),
 * });
 * ```
 *
 * Note: transforms and pipes are described from their *input* side for both
 * `schemaType: 'input'` and `'output'`, mirroring `createZodDto()`.
 */
export function createStandardSchemaConverter(): StandardSchemaConverter {
  return (schema) => {
    if (!isZodSchema(schema)) {
      return undefined;
    }

    ensureOpenapiExtension(schema);

    const refId = getRefId(schema as any);
    const registry = new OpenAPIRegistry();
    let components: Record<string, any>;
    try {
      // `register()` clones the schema before attaching the ref id, so the caller's
      // schema object is never tainted with INLINE_REF_ID.
      registry.register(refId ?? INLINE_REF_ID, schema as any);
      const generated = new OpenApiGeneratorV3(registry.definitions).generateComponents();
      components = { ...(generated.components?.schemas ?? {}) };
    } catch (err) {
      console.warn(
        `[nestjs-zod-openapi] Skipping Standard Schema${refId ? ` "${refId}"` : ''} in OpenAPI generation: ${
          (err as Error)?.message ?? String(err)
        }`,
      );
      return undefined;
    }

    // Same clean-up `patchNestSwagger` applies to DTO-generated components. The
    // registered (cloned) schema carries INLINE_REF_ID, so the inline copy is fixed too.
    fixGeneratedSchemas(registry, components);
    stripAdditionalPropsNullable(components);

    if (refId) {
      return { schema: { $ref: `#/components/schemas/${refId}` }, components };
    }

    const { [INLINE_REF_ID]: inline, ...named } = components;
    return { schema: inline ?? {}, components: named };
  };
}
