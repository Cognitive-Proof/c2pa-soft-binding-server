// ISCC (ISO 24138) soft bindings, `io.iscc.v0`, as specified by IEP-0020:
// https://ieps.iscc.codes/iep-0020/
//
// - isccMatcher(): a MatcherPlugin that indexes the ISCC-SEQs of stored
//   manifests and answers queries by Instance-Code equality and by the
//   Hamming similarity of Semantic-, Content- and Data-Codes.
// - isccExtractor: generates an ISCC-SEQ (Data-, Instance- and, for text, a
//   Text Content-Code) from an asset, for POST /matches/byContent.

import type { Extractor, Match, MatcherPlugin } from '@cognitiveproof/softbinding-api-plugin-types';
import { gen_data_code_v0, gen_instance_code_v0, gen_text_code_v0 } from '@iscc/lib';
import {
  decodeSeq,
  encodeSeq,
  InvalidIsccSeqError,
  MAINTYPE,
  SUBTYPE_IMAGE,
  type IsccUnit,
} from './seq';
import { createMemoryUnitStore, type StoredUnit, type UnitStore } from './store';

export * from './seq';
export * from './store';

export const ISCC_ALGORITHM = 'io.iscc.v0';
/** IEP-0020's threshold for resolvers without their own. */
export const DEFAULT_THRESHOLD = 80;
/** Most searchable units accepted in one value. */
export const MAX_UNITS = 32;
/** Longest base64 value accepted (about 90 256-bit units). */
export const MAX_VALUE_LENGTH = 4096;

const SIMILARITY_TYPES = new Set<number>([MAINTYPE.SEMANTIC, MAINTYPE.CONTENT, MAINTYPE.DATA]);
const BITS = 256;
const POPCOUNT = Array.from({ length: 256 }, (_, n) => n.toString(2).replace(/0/g, '').length);

/**
 * Same `name` as the server's InvalidSoftBindingValueError: the server answers
 * it with 400 (it matches errors by name, not class).
 */
export class InvalidSoftBindingValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidSoftBindingValueError';
  }
}

/** Decodes base64 leniently: standard or URL-safe, padded or not; a `+` sent unencoded as a space is restored. */
export function decodeBase64(value: string): Buffer {
  if (value.length > MAX_VALUE_LENGTH) {
    throw new InvalidSoftBindingValueError(`Value exceeds ${MAX_VALUE_LENGTH} characters`);
  }
  let text = value
    .replace(/ /g, '+')
    .trim()
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .replace(/=+$/, '');
  text += '='.repeat((4 - (text.length % 4)) % 4);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4 === 1) {
    throw new InvalidSoftBindingValueError('Value is not valid base64');
  }
  return Buffer.from(text, 'base64');
}

function popcount(bytes: Uint8Array): number {
  let n = 0;
  for (const byte of bytes) n += POPCOUNT[byte];
  return n;
}

/**
 * Whether an Image-Code is featureless: one of its 64-bit segments has fewer
 * than 8 bits set. IEP-0020 forbids comparing featureless Image-Codes.
 */
export function isFeatureless(unit: IsccUnit): boolean {
  if (unit.maintype !== MAINTYPE.CONTENT || unit.subtype !== SUBTYPE_IMAGE) return false;
  for (let i = 0; i + 8 <= unit.body.length; i += 8) {
    if (popcount(unit.body.subarray(i, i + 8)) < 8) return true;
  }
  return false;
}

/**
 * The units of an ISCC-SEQ that take part in matching: 256-bit Semantic-,
 * Content-, Data- and Instance-Codes, except featureless Image-Codes,
 * deduplicated. Meta-Codes and shorter units are ignored.
 */
export function searchableUnits(seq: Uint8Array): StoredUnit[] {
  const found = new Map<string, StoredUnit>();
  for (const unit of decodeSeq(seq)) {
    if (unit.length !== 7 || isFeatureless(unit)) continue;
    if (!SIMILARITY_TYPES.has(unit.maintype) && unit.maintype !== MAINTYPE.INSTANCE) continue;
    const key = `${unit.maintype}-${unit.subtype}-${unit.version}`;
    found.set(`${key}:${unit.body.toString('hex')}`, { key, body: unit.body });
  }
  return [...found.values()];
}

/** Similarity in percent, ⌊100 × (n − d) / n⌋ (IEP-0020). */
export function similarity(a: Uint8Array, b: Uint8Array): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += POPCOUNT[a[i] ^ b[i]];
  return Math.floor((100 * (BITS - d)) / BITS);
}

export interface IsccMatcherOptions {
  /** Where indexed units are kept. Default: in memory (lost on restart). */
  store?: UnitStore;
  /** Lowest similarity of a candidate match. Default: 80 (IEP-0020). */
  threshold?: number;
}

/** The searchable units of a base64 value; throws InvalidSoftBindingValueError if it isn't an ISCC-SEQ. */
function decodeValue(value: string): StoredUnit[] {
  try {
    return searchableUnits(decodeBase64(value));
  } catch (err) {
    if (err instanceof InvalidIsccSeqError) throw new InvalidSoftBindingValueError(err.message);
    throw err;
  }
}

function checkUnitCount(units: StoredUnit[]): void {
  if (units.length > MAX_UNITS) {
    throw new InvalidSoftBindingValueError(
      `Value holds more than ${MAX_UNITS} searchable ISCC-UNITs`,
    );
  }
}

/**
 * A MatcherPlugin for `io.iscc.v0`. A stored manifest scores 100 when an
 * Instance-Code equals one in the query (an exact match); otherwise its best
 * Semantic-, Content- or Data-Code similarity, capped at 99, if that reaches
 * the threshold. Best matches first, then in the order the store returns them.
 *
 * Each query compares against every stored unit of the same type, which is
 * fine for thousands of manifests, not millions.
 */
export function isccMatcher(options: IsccMatcherOptions = {}): MatcherPlugin {
  const store = options.store ?? createMemoryUnitStore();
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;

  return {
    kind: 'fingerprint',

    async index(manifestId, value, scope) {
      // IEP-0020: ignore a block with a non-empty scope.
      if (scope && typeof scope === 'object' && Object.keys(scope).length > 0) return;
      let units: StoredUnit[];
      try {
        units = decodeValue(value);
      } catch (err) {
        // A malformed ISCC-SEQ isn't indexed, as a resolver ignores it.
        if (err instanceof InvalidSoftBindingValueError) return;
        throw err;
      }
      checkUnitCount(units); // refuses the upload
      if (units.length) await store.add(manifestId, units);
    },

    remove(manifestId) {
      return store.remove(manifestId);
    },

    async match(value, maxResults) {
      const units = decodeValue(value);
      checkUnitCount(units);
      if (!units.length) {
        throw new InvalidSoftBindingValueError(
          'Value holds no 256-bit Semantic-, Content-, Data- or Instance-Code',
        );
      }
      const scores = new Map<string, number>();
      const raise = (manifestId: string, score: number) =>
        scores.set(manifestId, Math.max(score, scores.get(manifestId) ?? 0));

      for (const key of new Set(units.map((u) => u.key))) {
        const rows = await store.byKey(key);
        for (const unit of units.filter((u) => u.key === key)) {
          const instance = key.startsWith(`${MAINTYPE.INSTANCE}-`);
          for (const row of rows) {
            if (instance) {
              if (row.body.equals(unit.body)) raise(row.manifestId, 100);
            } else {
              const s = Math.min(99, similarity(unit.body, row.body));
              if (s >= threshold) raise(row.manifestId, s);
            }
          }
        }
      }

      const matches: Match[] = [...scores].map(([manifestId, similarityScore]) => ({
        manifestId,
        similarityScore,
      }));
      return matches.sort((a, b) => b.similarityScore - a.similarityScore).slice(0, maxResults);
    },
  };
}

/**
 * Generates an ISCC-SEQ from an asset: its Data-Code and Instance-Code, and
 * a Text Content-Code for `text/*` assets that are valid UTF-8. Returns it as
 * base64, for `createServer({ extractors: { [ISCC_ALGORITHM]: isccExtractor } })`.
 *
 * Image, audio and video Content-Codes need decoded media and aren't
 * generated; their assets still match by Data- and Instance-Code.
 */
export const isccExtractor: Extractor = async (buffer, mimeType) => {
  const units = [gen_data_code_v0(buffer, 256), gen_instance_code_v0(buffer, 256)];
  if (mimeType.startsWith('text/')) {
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
      if (text.trim()) units.unshift(gen_text_code_v0(text, 256));
    } catch {
      // Not UTF-8: Data- and Instance-Code only.
    }
  }
  return encodeSeq(units).toString('base64');
};
