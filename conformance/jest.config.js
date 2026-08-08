// Self-tests for the conformance harness's own logic (discovery parsing,
// fixture bookkeeping, etc). Offline — no network calls, safe for the root
// `npm test` to run automatically. The live conformance suite that actually
// calls a real target server lives in jest.conformance.config.js instead.
module.exports = {
  ...require('../jest.preset')(__dirname),
};
