/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  setupFiles: ['<rootDir>/jest.setup.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.jest.json' }],
    '^.+\\.js$': 'babel-jest',
  },
  // jose ships ESM-only; transform it to CJS so Jest's CommonJS runtime can load it.
  transformIgnorePatterns: ['/node_modules/(?!jose)'],
};
