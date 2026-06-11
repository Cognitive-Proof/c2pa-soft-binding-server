// Shared Jest config for plugin packages. Each plugin's jest.config.js does:
//
//   module.exports = require('../../jest.preset')(__dirname);
//
// ts-jest is configured with an inline tsconfig override (rather than a
// separate tsconfig.jest.json per plugin) so test files can use @types/jest
// without being included in the package's `tsc` build/declaration output.
module.exports = (dir) => ({
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: dir,
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          ...require(`${dir}/tsconfig.json`).compilerOptions,
          noEmit: true,
          declaration: false,
          types: ['jest', 'node'],
        },
      },
    ],
  },
});
