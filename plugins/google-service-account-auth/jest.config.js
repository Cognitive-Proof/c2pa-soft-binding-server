/** @type {import('jest').Config} */
const preset = require('../../jest.preset')(__dirname);

// Tests sign and verify real tokens, so jose (ESM-only) has to be transformed
// to CJS the same way the root jest.config.js does.
module.exports = {
  ...preset,
  transform: {
    ...preset.transform,
    '^.+\\.js$': ['babel-jest', { rootMode: 'upward' }],
  },
  transformIgnorePatterns: ['/node_modules/(?!jose)'],
};
