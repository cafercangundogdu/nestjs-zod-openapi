import 'reflect-metadata';

/**
 * Tests for init.ts — specifically the already-initialized guard (line 21).
 *
 * The setup.ts file already calls initZodOpenApi(z) once before all tests.
 * Calling it again should hit the `if (initialized) return;` guard.
 */
describe('initZodOpenApi', () => {
  it('should not throw when called a second time (already-initialized guard)', () => {
    const { z } = require('zod');
    const { initZodOpenApi } = require('../src');

    // setup.ts already called initZodOpenApi(z), so this should hit line 21
    expect(() => initZodOpenApi(z)).not.toThrow();
  });

  it('should still work after second call — .openapi() should still be available', () => {
    const { z } = require('zod');

    // Verify .openapi() still works
    const schema = z.object({ x: z.string() }).openapi('TestInit');
    expect(schema).toBeDefined();
  });

  it('should re-export extendZodWithOpenApi', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const init = require('../src/init');
    expect(typeof init.extendZodWithOpenApi).toBe('function');
  });
});
