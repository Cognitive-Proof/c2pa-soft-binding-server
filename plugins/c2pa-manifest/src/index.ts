// A ManifestReader for createServer({ readManifest }) that validates uploaded
// C2PA Manifest Stores with c2pa-rs (through @contentauth/c2pa-node) and
// reports their manifest id and soft-binding blocks.
//
// The asset is never uploaded alongside its manifest, so hard-binding
// failures are expected and tolerated. A signing credential outside the trust
// anchors (or expired) is recorded as untrusted rather than refused, unless
// `requireTrusted` is set. Any other validation failure of the active
// manifest refuses the upload, so a tampered assertion — a soft binding
// among them — never reaches the store. So do bytes after the Manifest Store
// (c2pa-rs ignores them, but the server would store and serve them) and
// ingredient manifests changed after signing.

import type { Settings } from '@contentauth/c2pa-utilities' with { 'resolution-mode': 'import' };
import type { ManifestInfo, SoftBindingBlock } from '@cognitiveproof/softbinding-api-plugin-types';

type C2paNode = typeof import('@contentauth/c2pa-node', { with: { 'resolution-mode': 'import' } });
type C2paUtilities = typeof import('@contentauth/c2pa-utilities', {
  with: { 'resolution-mode': 'import' },
});

// c2pa-node and c2pa-utilities are ESM-only. This package compiles to
// CommonJS with `module: node16`, which keeps these as native dynamic
// imports, loaded the first time a reader is used.
let modules: Promise<[C2paNode, C2paUtilities]> | undefined;
function loadC2pa(): Promise<[C2paNode, C2paUtilities]> {
  modules ??= Promise.all([
    import('@contentauth/c2pa-node'),
    import('@contentauth/c2pa-utilities'),
  ]);
  return modules;
}

export const MEDIA_TYPE = 'application/c2pa';
/** Longest manifest label accepted as a manifestId. */
export const MAX_ID_LENGTH = 255;

const SIGNATURE_VALIDATED = 'claimSignature.validated';
const UNTRUSTED = 'signingCredential.untrusted';
const EXPIRED = 'signingCredential.expired';
// Failures caused by the missing asset: its hard binding can't be checked
// against a bare Manifest Store.
const HARD_BINDING_FAILURES = new Set([
  'assertion.dataHash.mismatch',
  'assertion.boxesHash.mismatch',
  'assertion.bmffHash.mismatch',
  'assertion.collectionHash.mismatch',
]);
const SOFT_BINDING = 'c2pa.soft-binding';

export interface C2paManifestReaderOptions {
  /**
   * PEM trust anchors that signing credentials are checked against, e.g. the
   * C2PA trust list. Without any, every manifest is reported untrusted.
   */
  trustAnchors?: string;
  /** Refuse manifests whose signing credential isn't trusted. Default: false. */
  requireTrusted?: boolean;
  /**
   * Accept a signing credential that has expired (without a trusted time
   * stamp), as untrusted. c2pa-rs doesn't report the claim signature as
   * validated in that case. Default: true.
   */
  allowExpired?: boolean;
}

/** Thrown for an upload that isn't an acceptable Manifest Store; `code` is a C2PA status code or our own. */
export class InvalidManifestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = 'InvalidManifestError';
  }
}

interface StatusEntry {
  code: string;
}

/** The parts of a c2pa-rs Reader report this plugin looks at. */
export interface C2paReport {
  active_manifest?: string;
  manifests?: Record<string, { assertions?: Array<{ label?: string; data?: unknown }> }>;
  validation_results?: {
    activeManifest?: { success?: StatusEntry[]; failure?: StatusEntry[] };
    ingredientDeltas?: Array<{ validationDeltas?: { failure?: StatusEntry[] } }>;
  };
}

/**
 * c2pa-rs settings that keep reading offline: no remote manifests, OCSP or
 * CAWG identity resolution (which would fetch DID documents from hosts the
 * uploader names). `core` isn't in c2pa-node's Settings type but is passed
 * through to c2pa-rs.
 */
export function readerSettings(trustAnchors?: string): Settings {
  return {
    verify: { verifyTrust: true, remoteManifestFetch: false, ocspFetch: false },
    ...(trustAnchors ? { trust: { trustAnchors } } : {}),
    core: { decodeIdentityAssertions: false, allowedNetworkHosts: [] },
  } as Settings;
}

/**
 * Refuses bytes after the Manifest Store: the length its outer JUMBF box
 * declares (LBox, or the 64-bit XLBox when LBox is 1) must be the upload's.
 */
export function checkLength(data: Buffer): void {
  let length = data.length >= 4 ? data.readUInt32BE(0) : -1;
  if (length === 1) length = data.length >= 16 ? Number(data.readBigUInt64BE(8)) : -1;
  if (length !== data.length) {
    throw new InvalidManifestError(
      'manifest.trailingData',
      'The upload must be the Manifest Store alone, as one JUMBF superbox',
    );
  }
}

/** Raw-bytes base64 of a soft-binding block value, or undefined for one that isn't a byte string. */
function blockValue(value: unknown): string | undefined {
  if (Array.isArray(value) && value.every((b) => Number.isInteger(b) && b >= 0 && b < 256)) {
    return value.length ? Buffer.from(value as number[]).toString('base64') : undefined;
  }
  if (typeof value === 'string') {
    // c2pa-rs writes byte strings in its JSON report as b64'…'.
    const b64 = /^b64'(.*)'$/.exec(value)?.[1] ?? value;
    if (/^[A-Za-z0-9+/]+={0,2}$/.test(b64) && b64.length % 4 === 0) return b64;
  }
  return undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Every block of every soft-binding assertion that names an algorithm and has a byte-string value. */
export function softBindings(
  assertions: Array<{ label?: string; data?: unknown }> = [],
): SoftBindingBlock[] {
  const found: SoftBindingBlock[] = [];
  for (const assertion of assertions) {
    const label = assertion.label ?? '';
    if (label !== SOFT_BINDING && !label.startsWith(`${SOFT_BINDING}__`)) continue;
    const data = (assertion.data ?? {}) as { alg?: unknown; blocks?: unknown };
    if (typeof data.alg !== 'string' || !data.alg || !Array.isArray(data.blocks)) continue;
    for (const block of data.blocks as Array<{ value?: unknown; scope?: unknown }>) {
      const value = blockValue(block?.value);
      if (!value) continue;
      // An empty scope covers the whole asset, the same as none.
      const scoped = isObject(block.scope) && Object.keys(block.scope).length > 0;
      found.push({ alg: data.alg, value, ...(scoped ? { scope: block.scope } : {}) });
    }
  }
  return found;
}

/** Applies the acceptance policy to a c2pa-rs report and summarises it. */
export function checkReport(
  report: C2paReport,
  options: C2paManifestReaderOptions = {},
): ManifestInfo {
  const { requireTrusted = false, allowExpired = true } = options;
  const label = report.active_manifest;
  if (!label) {
    throw new InvalidManifestError('manifest.missing', 'The Manifest Store has no active manifest');
  }
  // eslint-disable-next-line no-control-regex
  if (label.length > MAX_ID_LENGTH || /[\u0000-\u001f\u007f]/.test(label)) {
    throw new InvalidManifestError(
      'manifest.idInvalid',
      `The manifest id must be printable, at most ${MAX_ID_LENGTH} characters`,
    );
  }

  const active = report.validation_results?.activeManifest ?? {};
  const failures = (active.failure ?? []).map((f) => f.code);
  const successes = (active.success ?? []).map((s) => s.code);
  const tolerated = new Set([
    ...HARD_BINDING_FAILURES,
    UNTRUSTED,
    ...(allowExpired ? [EXPIRED] : []),
  ]);
  const refusing = failures.find((code) => !tolerated.has(code));
  if (refusing) throw new InvalidManifestError(refusing, 'The active manifest failed validation');

  const expired = failures.includes(EXPIRED);
  if (!successes.includes(SIGNATURE_VALIDATED) && !expired) {
    throw new InvalidManifestError(
      'claimSignature.missing',
      'The claim signature of the active manifest is unverified',
    );
  }

  const changed = (report.validation_results?.ingredientDeltas ?? [])
    .flatMap((delta) => delta.validationDeltas?.failure ?? [])
    .map((f) => f.code)
    .find((code) => code.endsWith('.mismatch'));
  if (changed) throw new InvalidManifestError(changed, 'An ingredient manifest failed validation');

  const trusted = !failures.includes(UNTRUSTED) && !expired;
  if (requireTrusted && !trusted) {
    throw new InvalidManifestError(UNTRUSTED, 'The signing credential is not trusted');
  }

  return {
    manifestId: label,
    bindings: softBindings(report.manifests?.[label]?.assertions),
    trusted,
  };
}

/**
 * Builds a ManifestReader for `createServer({ readManifest })`.
 *
 * ```ts
 * import { createC2paManifestReader } from '@cognitiveproof/softbinding-api-plugin-c2pa-manifest';
 *
 * createServer({
 *   readManifest: createC2paManifestReader({ trustAnchors: fs.readFileSync('C2PA-TRUST-LIST.pem', 'utf8') }),
 * });
 * ```
 */
export function createC2paManifestReader(
  options: C2paManifestReaderOptions = {},
): (data: Buffer) => Promise<ManifestInfo> {
  const settings = readerSettings(options.trustAnchors);
  let context: InstanceType<C2paUtilities['Context']> | undefined;

  return async (data) => {
    const [{ Reader }, { Context }] = await loadC2pa();
    context ??= new Context(settings);
    let report: C2paReport;
    try {
      const reader = await Reader.fromAsset({ buffer: data, mimeType: MEDIA_TYPE }, context);
      if (!reader) throw new Error('No C2PA Manifest Store found');
      report = reader.json() as unknown as C2paReport;
    } catch (err) {
      throw new InvalidManifestError(
        'manifest.unreadable',
        err instanceof Error && err.message ? err.message : 'Not a C2PA Manifest Store',
      );
    }
    checkLength(data);
    return checkReport(report, options);
  };
}
