import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    // SWC instead of Vite's built-in TypeScript transform: the suite depends on
    // `design:paramtypes` metadata (@nestjs/swagger's parameter explorer reads it),
    // which only a transform that implements `emitDecoratorMetadata` can produce.
    // SWC only transpiles — type checking lives in `pnpm run typecheck`.
    swc.vite({
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        target: 'es2022',
      },
      module: { type: 'es6' },
    }),
  ],
  test: {
    include: ['test/**/*.spec.ts'],
    environment: 'node',
    globals: false,
    setupFiles: ['./test/setup.ts'],
    // `patchNestSwagger()` mutates @nestjs/swagger prototypes, so every spec file
    // needs a pristine process: forks + isolation gives each file its own child
    // process and therefore its own module registry.
    pool: 'forks',
    isolate: true,
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      // Vitest 5 matches include/exclude against project-relative paths only, so
      // `src/**` no longer also matches `example/src/**` the way v4's picomatch
      // `contains` matching did. That made v4's `excludeAfterRemap: true` workaround
      // redundant, so it is gone; `exclude` is kept to state the intent explicitly —
      // the example app is imported by example-app.spec.ts but is not measured.
      exclude: ['example/**'],
      reporter: ['text', 'lcov'],
      reportsDirectory: './coverage',
      // Floors sit ~5 points below the weaker of the two CI legs, rounded down to a
      // multiple of 5. NestJS 11 is the weaker leg on every metric because the
      // swagger-12-only code paths are skipped there:
      //   nest 11 -> stmts 91.11 / branches 82.22 / funcs 95.74 / lines 92.00
      //   nest 12 -> stmts 93.40 / branches 85.54 / funcs 97.87 / lines 94.57
      thresholds: {
        statements: 85,
        branches: 75,
        functions: 90,
        lines: 85,
      },
    },
  },
});
