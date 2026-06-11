/** @type {import('jest').Config} */
module.exports = {
  ...require('../../jest.preset')(__dirname),
  setupFiles: ['<rootDir>/jest.setup.ts'],
};
