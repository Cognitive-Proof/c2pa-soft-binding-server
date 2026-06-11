import type { Extractor } from '@cognitiveproof/softbinding-api-plugin-types';
import { decode } from './codec';

export { encode, decode } from './codec';

/**
 * Soft binding algorithm name for the variation-selector text watermark,
 * for use as a key in `createServer({ extractors })`.
 */
export const VSMARK_ALGORITHM = 'com.cognitiveproof.vsmark.v1';

/**
 * Extractor that recovers a soft binding value hidden in text content (e.g.
 * `text/plain`, `text/html`) via invisible Unicode variation selectors (see
 * `encode()`). Returns `null` if the asset isn't UTF-8 text or no hidden
 * value is found.
 *
 * ```ts
 * import { vsmarkExtractor, VSMARK_ALGORITHM } from '@cognitiveproof/softbinding-api-plugin-vsmark';
 *
 * createServer({
 *   extractors: { [VSMARK_ALGORITHM]: vsmarkExtractor },
 * });
 * ```
 */
export const vsmarkExtractor: Extractor = async (buffer) => {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return null;
  }

  return decode(text) ?? null;
};
