import type { z } from 'zod';

/**
 * Helpers that walk Zod 4 schema internals (`schema._zod.def`). Shared by the
 * DTO metadata factory, the Swagger patch and the Standard Schema converter so
 * they all agree on what "nullable", "pattern" and "shape" mean.
 */

/** Modifier wrappers that expose an `innerType` and do not affect nullability. */
const NULL_TRANSPARENT_WRAPPERS = new Set([
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

/** Every modifier wrapper, including `nullable`. */
const WRAPPERS = new Set([...NULL_TRANSPARENT_WRAPPERS, 'nullable']);

/**
 * Unwraps Zod modifier wrappers (optional, nullable, default, etc.)
 * to reach the inner schema.
 */
export function unwrapToInner(schema: any): any {
  let s = schema;
  while (s?._zod?.def) {
    const type: string | undefined = s._zod.def.type;
    if (type && WRAPPERS.has(type) && s._zod.def.innerType) {
      s = s._zod.def.innerType;
      continue;
    }
    break;
  }
  return s;
}

/**
 * Determines whether a Zod schema is structurally nullable — i.e., whether it
 * is explicitly wrapped in `.nullable()` (ZodNullable) somewhere in its
 * modifier chain.  This differs from the runtime check
 * `schema.safeParse(null).success`, which returns true for `z.coerce.*` types
 * because JavaScript coercion happens to accept `null` (e.g. `new Date(null)`
 * produces epoch, `String(null)` produces `"null"`).
 */
export function isStructurallyNullable(schema: any): boolean {
  let s = schema;
  while (s?._zod?.def) {
    const type: string | undefined = s._zod.def.type;
    if (type === 'nullable') return true;
    if (type && NULL_TRANSPARENT_WRAPPERS.has(type) && s._zod.def.innerType) {
      s = s._zod.def.innerType;
      continue;
    }
    break;
  }
  return false;
}

/**
 * Extracts the regex pattern from a Zod schema's format checks (e.g. .uuid(), .email()).
 * Unwraps modifiers first; Zod stores the regex in `_zod.def.checks[].def.pattern` as a RegExp.
 */
export function extractZodPattern(schema: any): string | undefined {
  const inner = unwrapToInner(schema);
  const checks: any[] = inner?._zod?.def?.checks ?? [];
  for (const check of checks) {
    const pat = check?.def?.pattern;
    if (pat instanceof RegExp) return pat.source;
  }
  return undefined;
}

/**
 * Extracts the shape (Record<string, ZodType>) from a Zod object schema.
 * Returns `undefined` for non-object schemas.
 */
export function getZodObjectShape(schema: any): Record<string, any> | undefined {
  const inner = unwrapToInner(schema);
  const shape = inner?._zod?.def?.shape ?? inner?.shape;
  if (shape && typeof shape === 'object') return shape;
  return undefined;
}

/**
 * Unwraps a Zod schema to find the array element type.
 * Handles `z.array(inner)` and `z.array(inner).optional()` etc.
 */
export function unwrapToArrayElement(schema: any): any {
  const inner = unwrapToInner(schema);
  // ZodArray: element is in _zod.def.element or .element
  return inner?._zod?.def?.element ?? inner?.element ?? undefined;
}

/**
 * Checks if a Zod schema is an object with `.passthrough()` applied.
 * In Zod 4, `.passthrough()` sets `_zod.def.catchall` to z.unknown().
 */
export function isPassthroughObject(schema: any): boolean {
  const inner = unwrapToInner(schema);
  if (inner?._zod?.def?.type !== 'object') return false;
  // Zod 4: .passthrough() sets catchall to z.unknown()
  // .strict() sets catchall to z.never()
  // No modifier: catchall is undefined
  const catchall = inner._zod.def.catchall;
  const catchallType = catchall?._zod?.def?.type;
  return catchallType === 'unknown' || catchallType === 'any';
}

/**
 * Extracts the value type from a Zod record schema (z.record(keyType, valueType)).
 * Unwraps modifiers to reach the ZodRecord, then returns the valueType.
 */
export function getRecordValueType(schema: any): any {
  const inner = unwrapToInner(schema);
  return inner?._zod?.def?.valueType ?? undefined;
}

/**
 * Type guard: `true` when `value` is a Zod schema. Uses the Standard Schema
 * vendor tag (present on every Zod 4 schema) rather than `instanceof`, so it
 * also recognises schemas built by a different copy of Zod.
 */
export function isZodSchema(value: unknown): value is z.ZodType {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return false;
  const candidate = value as { '~standard'?: { vendor?: unknown }; safeParse?: unknown };
  return candidate['~standard']?.vendor === 'zod' && typeof candidate.safeParse === 'function';
}
