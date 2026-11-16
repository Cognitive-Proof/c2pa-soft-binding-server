# Test fixtures

- `iscc-signed.c2pa`: a C2PA sidecar (no asset) signed with `@contentauth/c2pa-node` 0.12.0 by a throwaway ES256 certificate issued by `test-ca.pem` (both valid until 2126). Its active manifest has a `c2pa.created` action and one `io.iscc.v0` soft binding whose value is IEP-0020 test vector 1. The private keys were not kept.
- `test-ca.pem`: the throwaway CA, for tests of the trusted path.
- `manifest-c2pa-rs.c2pa`: `sdk/tests/fixtures/ingredient/manifest_data.c2pa` from [c2pa-rs](https://github.com/contentauth/c2pa-rs) (Apache-2.0 or MIT), signed by the c2pa-rs test certificate, without soft bindings.
- `cawg-c2pa-rs.c2pa`: the Manifest Store of the c2pa-rs fixture `C_with_CAWG_data.jpg` (Apache-2.0 or MIT), with a CAWG identity assertion and TrustMark and ICN soft bindings. Its signing certificate has expired.

The last two were copied from [iscc-c2pa-store](https://github.com/iscc/iscc-c2pa-store) (Apache-2.0).
