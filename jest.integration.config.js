// Real-library integration tests — these sign and verify actual C2PA
// manifests via c2pa-rs-javascript-library (WASM) and shell out to openssl
// for throwaway test certificates. Slower and heavier than the default
// suite, so they're excluded from it (see jest.config.js) and only run via
// `npm run test:integration`.
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: __dirname,
  roots: ['<rootDir>/src/__tests__/integration'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.jest.json' }],
    '^.+\\.js$': 'babel-jest',
  },
  // c2pa-rs-javascript-library ships ESM-only; transform it to CJS so
  // Jest's CommonJS runtime can load it (same treatment jest.config.js
  // gives `jose`).
  transformIgnorePatterns: ['/node_modules/(?!c2pa-rs-javascript-library)'],
  testTimeout: 60_000,
};
