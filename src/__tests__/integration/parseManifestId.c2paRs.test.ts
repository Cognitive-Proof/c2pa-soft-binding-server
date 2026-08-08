/**
 * Integration test against the real `c2pa-rs-javascript-library` (Rust/WASM
 * C2PA bindings) — NOT part of the default `npm test` run (see
 * jest.config.js's `testPathIgnorePatterns`). Run explicitly via
 * `npm run test:integration`.
 *
 * Signs a real C2PA sidecar manifest and confirms `createServer()`'s
 * `parseManifestId` option wires a real C2PA parser end-to-end: the id it
 * derives matches exactly what the library itself reports as the active
 * manifest, and re-uploading the identical bytes is idempotent. See the
 * README section "Deriving manifestId from the Manifest Itself" for the
 * non-test version of this same wiring.
 */
import type { RequestHandler } from 'express';
import request from 'supertest';
import { signAssetSidecar, verifyManifestBytes } from 'c2pa-rs-javascript-library';
import { createServer } from '../../index';
import { createFakeDataStore } from '../helpers/fakeDataStore';

const allowAll: RequestHandler = (_req, _res, next) => next();

// The official "FOR TESTING ONLY" ES256 sample leaf+intermediate cert chain
// and matching private key, as published by Adobe's contentauth/c2pa-rs at
// cli/sample/es256_certs.pem / es256_private.key — a known-good fixture that
// satisfies the C2PA certificate profile (X.509v3, ES256, emailProtection
// EKU, not self-signed) without needing to hand-generate one.
const SIGNCERT = Buffer.from(
  `-----BEGIN CERTIFICATE-----
MIIChzCCAi6gAwIBAgIUcCTmJHYF8dZfG0d1UdT6/LXtkeYwCgYIKoZIzj0EAwIw
gYwxCzAJBgNVBAYTAlVTMQswCQYDVQQIDAJDQTESMBAGA1UEBwwJU29tZXdoZXJl
MScwJQYDVQQKDB5DMlBBIFRlc3QgSW50ZXJtZWRpYXRlIFJvb3QgQ0ExGTAXBgNV
BAsMEEZPUiBURVNUSU5HX09OTFkxGDAWBgNVBAMMD0ludGVybWVkaWF0ZSBDQTAe
Fw0yMjA2MTAxODQ2NDBaFw0zMDA4MjYxODQ2NDBaMIGAMQswCQYDVQQGEwJVUzEL
MAkGA1UECAwCQ0ExEjAQBgNVBAcMCVNvbWV3aGVyZTEfMB0GA1UECgwWQzJQQSBU
ZXN0IFNpZ25pbmcgQ2VydDEZMBcGA1UECwwQRk9SIFRFU1RJTkdfT05MWTEUMBIG
A1UEAwwLQzJQQSBTaWduZXIwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAAQPaL6R
kAkYkKU4+IryBSYxJM3h77sFiMrbvbI8fG7w2Bbl9otNG/cch3DAw5rGAPV7NWky
l3QGuV/wt0MrAPDoo3gwdjAMBgNVHRMBAf8EAjAAMBYGA1UdJQEB/wQMMAoGCCsG
AQUFBwMEMA4GA1UdDwEB/wQEAwIGwDAdBgNVHQ4EFgQUFznP0y83joiNOCedQkxT
tAMyNcowHwYDVR0jBBgwFoAUDnyNcma/osnlAJTvtW6A4rYOL2swCgYIKoZIzj0E
AwIDRwAwRAIgOY/2szXjslg/MyJFZ2y7OH8giPYTsvS7UPRP9GI9NgICIDQPMKrE
LQUJEtipZ0TqvI/4mieoyRCeIiQtyuS0LACz
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIICajCCAg+gAwIBAgIUfXDXHH+6GtA2QEBX2IvJ2YnGMnUwCgYIKoZIzj0EAwIw
dzELMAkGA1UEBhMCVVMxCzAJBgNVBAgMAkNBMRIwEAYDVQQHDAlTb21ld2hlcmUx
GjAYBgNVBAoMEUMyUEEgVGVzdCBSb290IENBMRkwFwYDVQQLDBBGT1IgVEVTVElO
R19PTkxZMRAwDgYDVQQDDAdSb290IENBMB4XDTIyMDYxMDE4NDY0MFoXDTMwMDgy
NzE4NDY0MFowgYwxCzAJBgNVBAYTAlVTMQswCQYDVQQIDAJDQTESMBAGA1UEBwwJ
U29tZXdoZXJlMScwJQYDVQQKDB5DMlBBIFRlc3QgSW50ZXJtZWRpYXRlIFJvb3Qg
Q0ExGTAXBgNVBAsMEEZPUiBURVNUSU5HX09OTFkxGDAWBgNVBAMMD0ludGVybWVk
aWF0ZSBDQTBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABHllI4O7a0EkpTYAWfPM
D6Rnfk9iqhEmCQKMOR6J47Rvh2GGjUw4CS+aLT89ySukPTnzGsMQ4jK9d3V4Aq4Q
LsOjYzBhMA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgGGMB0GA1UdDgQW
BBQOfI1yZr+iyeUAlO+1boDitg4vazAfBgNVHSMEGDAWgBRembiG4Xgb2VcVWnUA
UrYpDsuojDAKBggqhkjOPQQDAgNJADBGAiEAtdZ3+05CzFo90fWeZ4woeJcNQC4B
84Ill3YeZVvR8ZECIQDVRdha1xEDKuNTAManY0zthSosfXcvLnZui1A/y/DYeg==
-----END CERTIFICATE-----`,
);

const PKEY = Buffer.from(
  `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgfNJBsaRLSeHizv0m
GL+gcn78QmtfLSm+n+qG9veC2W2hRANCAAQPaL6RkAkYkKU4+IryBSYxJM3h77sF
iMrbvbI8fG7w2Bbl9otNG/cch3DAw5rGAPV7NWkyl3QGuV/wt0MrAPDo
-----END PRIVATE KEY-----`,
);

async function parseManifestId(data: Buffer): Promise<string> {
  const result = await verifyManifestBytes(data, []);
  const activeManifest = result.manifestStore?.activeManifest;
  if (!activeManifest) {
    throw new Error('No active manifest found in this C2PA Manifest Store');
  }
  return activeManifest;
}

function buildApp() {
  const dataStore = createFakeDataStore();
  const app = createServer({
    dataStore,
    auth: allowAll,
    docs: false,
    parseManifestId,
  });
  return { app, dataStore };
}

describe('parseManifestId with c2pa-rs-javascript-library', () => {
  let manifestBytes: Buffer;

  beforeAll(async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">' +
        '<rect width="10" height="10" fill="blue"/></svg>',
    );

    const signed = await signAssetSidecar({
      format: 'image/svg+xml',
      asset: svg,
      manifestDefinition: {
        claim_generator_info: [{ name: 'softbinding-server-integration-test' }],
        title: 'integration-test.svg',
        assertions: [
          {
            label: 'c2pa.actions',
            data: {
              actions: [
                {
                  action: 'c2pa.created',
                  digitalSourceType:
                    'http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture',
                },
              ],
            },
          },
        ],
      },
      signcert: SIGNCERT,
      pkey: PKEY,
      alg: 'es256',
    });
    manifestBytes = Buffer.from(signed.manifest);
  });

  it('stores the manifest under the id the library itself reports as active', async () => {
    const { app } = buildApp();
    const expected = await verifyManifestBytes(manifestBytes, []);
    const expectedId = expected.manifestStore?.activeManifest;

    expect(expectedId).toMatch(/^urn:c2pa:/);

    const res = await request(app)
      .post('/v1/manifests')
      .set('Content-Type', 'application/c2pa')
      .send(manifestBytes);

    expect(res.status).toBe(200);
    expect(res.body.manifestId).toBe(expectedId);
  });

  it('is idempotent when the identical signed manifest is uploaded twice', async () => {
    const { app } = buildApp();

    const first = await request(app)
      .post('/v1/manifests')
      .set('Content-Type', 'application/c2pa')
      .send(manifestBytes);
    const second = await request(app)
      .post('/v1/manifests')
      .set('Content-Type', 'application/c2pa')
      .send(manifestBytes);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.manifestId).toBe(first.body.manifestId);
  });
});
