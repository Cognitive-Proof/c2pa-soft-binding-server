// Plugin registry for soft binding extraction.
//
// To add a watermark or fingerprint algorithm:
//   import { registerExtractor } from './softBinding';
//   registerExtractor('com.example.watermark.v1', async (buffer, mimeType) => {
//     // Detect watermark in buffer, return base64-encoded binding value or null
//     const id = await myWatermarkLib.detect(buffer);
//     return id ? Buffer.from(id).toString('base64') : null;
//   });
//
// Algorithm names must appear in the C2PA soft binding algorithm list:
//   https://github.com/c2pa-org/softbinding-algorithm-list

export type Extractor = (buffer: Buffer, mimeType: string) => Promise<string | null>;

export interface SupportedAlgorithms {
  watermarks: Array<{ alg: string }>;
  fingerprints: Array<{ alg: string }>;
}

const supportedWatermarks: string[] = [];
const supportedFingerprints: string[] = [];
const extractors = new Map<string, Extractor>();

export function registerExtractor(alg: string, fn: Extractor): void {
  extractors.set(alg, fn);
  if (alg.includes('watermark') && !supportedWatermarks.includes(alg)) {
    supportedWatermarks.push(alg);
  } else if (!supportedFingerprints.includes(alg)) {
    supportedFingerprints.push(alg);
  }
}

export async function extractSoftBinding(
  buffer: Buffer,
  mimeType: string,
  alg: string,
): Promise<string | null> {
  const fn = extractors.get(alg);
  if (!fn) return null;
  return fn(buffer, mimeType);
}

export function getSupportedAlgorithms(): SupportedAlgorithms {
  return {
    watermarks: supportedWatermarks.map(alg => ({ alg })),
    fingerprints: supportedFingerprints.map(alg => ({ alg })),
  };
}
