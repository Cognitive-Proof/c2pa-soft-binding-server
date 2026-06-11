// Soft binding extraction registry.
//
// Watermark detection and content fingerprinting are algorithm-specific and
// typically provided by specialised third-party libraries. createServer()
// builds one of these registries per server instance from the `extractors`
// option:
//
//   createServer({
//     extractors: {
//       'com.example.watermark.v1': async (buffer, mimeType) => {
//         const id = await myWatermarkLib.detect(buffer);
//         return id ? Buffer.from(id).toString('base64') : null;
//       },
//     },
//   });
//
// Algorithm names must appear in the C2PA soft binding algorithm list:
//   https://github.com/c2pa-org/softbinding-algorithm-list

export type Extractor = (buffer: Buffer, mimeType: string) => Promise<string | null>;

export interface SupportedAlgorithms {
  watermarks: Array<{ alg: string }>;
  fingerprints: Array<{ alg: string }>;
}

export interface SoftBindingRegistry {
  registerExtractor(alg: string, fn: Extractor): void;
  extractSoftBinding(buffer: Buffer, mimeType: string, alg: string): Promise<string | null>;
  getSupportedAlgorithms(): SupportedAlgorithms;
}

export function createSoftBindingRegistry(
  extractors: Record<string, Extractor> = {},
): SoftBindingRegistry {
  const supportedWatermarks: string[] = [];
  const supportedFingerprints: string[] = [];
  const registry = new Map<string, Extractor>();

  function registerExtractor(alg: string, fn: Extractor): void {
    registry.set(alg, fn);
    if (alg.includes('watermark') && !supportedWatermarks.includes(alg)) {
      supportedWatermarks.push(alg);
    } else if (!supportedFingerprints.includes(alg)) {
      supportedFingerprints.push(alg);
    }
  }

  async function extractSoftBinding(
    buffer: Buffer,
    mimeType: string,
    alg: string,
  ): Promise<string | null> {
    const fn = registry.get(alg);
    if (!fn) return null;
    return fn(buffer, mimeType);
  }

  function getSupportedAlgorithms(): SupportedAlgorithms {
    return {
      watermarks: supportedWatermarks.map(alg => ({ alg })),
      fingerprints: supportedFingerprints.map(alg => ({ alg })),
    };
  }

  for (const [alg, fn] of Object.entries(extractors)) {
    registerExtractor(alg, fn);
  }

  return { registerExtractor, extractSoftBinding, getSupportedAlgorithms };
}
