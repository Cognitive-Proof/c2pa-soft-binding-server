/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  // Real-library integration tests (e.g. against c2pa-rs-javascript-library)
  // run separately via `npm run test:integration` (jest.integration.config.js)
  // — kept out of the default fast/offline run.
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/src/__tests__/integration/'],
  setupFiles: ['<rootDir>/jest.setup.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.jest.json' }],
    '^.+\\.js$': 'babel-jest',
  },
  // jose ships ESM-only; transform it to CJS so Jest's CommonJS runtime can load it.
  transformIgnorePatterns: ['/node_modules/(?!jose)'],
};
