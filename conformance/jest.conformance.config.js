// The live conformance suite — makes real HTTP requests against whatever
// server CONFORMANCE_BASE_URL points at (set by src/cli.ts, or exported
// manually before running `jest --config jest.conformance.config.js`
// directly). Deliberately NOT picked up by the root `npm test` / this
// package's own `npm test` (see jest.config.js) so CI never accidentally
// tries to hit a network target.

// Once installed from npm, this package itself lives under node_modules, which
// Jest skips by default for both test discovery and transforms. Ignore only
// node_modules paths that aren't this package.
const ignoreOtherNodeModules = ['/node_modules/(?!@cognitiveproof/softbinding-api-conformance/)'];

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: __dirname,
  testMatch: ['<rootDir>/tests/**/*.conformance.test.ts'],
  testPathIgnorePatterns: ignoreOtherNodeModules,
  transformIgnorePatterns: ignoreOtherNodeModules,
  haste: { retainAllFiles: true },
  setupFilesAfterEnv: ['<rootDir>/jest.conformance.setup.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          ...require('./tsconfig.json').compilerOptions,
          noEmit: true,
          declaration: false,
          // Transpile only (no type-checking) so the published package
          // doesn't need @types/* dependencies at runtime — this suite is
          // already type-checked in the repo's own CI before publishing.
          isolatedModules: true,
        },
      },
    ],
  },
  testTimeout: 30_000,
};
