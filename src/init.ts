import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

let initialized = false;

/**
 * Extends Zod with the `.openapi()` method for OpenAPI schema generation.
 *
 * **Must be called once** before using `.openapi()` on Zod schemas.
 * Pass your application's `z` instance to ensure the correct copy
 * is extended (avoids pnpm/monorepo dual-package issues).
 *
 * @example
 * ```typescript
 * import { z } from 'zod';
 * import { initZodOpenApi } from '@cafercangundogdu/nestjs-zod-openapi';
 *
 * initZodOpenApi(z);
 * ```
 */
export function initZodOpenApi(z: unknown): void {
  if (initialized) return;
  initialized = true;
  extendZodWithOpenApi(z as any);
}

export { extendZodWithOpenApi };
