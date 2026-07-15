/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  // Source files use ESM-style `./foo.js` specifiers that resolve to `.ts`
  // files at test time (Node16-style resolution).
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    // @swc/jest instead of ts-jest: ts-jest depends on the JS compiler API
    // that typescript@7 (native compiler) no longer ships. SWC only
    // transpiles — type checking lives in `pnpm run typecheck`.
    '^.+\\.ts$': [
      '@swc/jest',
      {
        jsc: {
          parser: { syntax: 'typescript', decorators: true },
          transform: { legacyDecorator: true, decoratorMetadata: true },
          target: 'es2021',
        },
        module: { type: 'commonjs' },
      },
    ],
  },
  collectCoverageFrom: ['src/**/*.ts'],
  coverageDirectory: './coverage',
  testEnvironment: 'node',
  setupFiles: ['./test/setup.ts'],
};
