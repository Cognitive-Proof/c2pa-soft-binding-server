import type { RegionOfInterest } from '@cognitiveproof/softbinding-api-plugin-types';

const REGION_TYPES = new Set(['spatial', 'temporal', 'frame', 'textual', 'identified']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidRegion(region: unknown): region is RegionOfInterest {
  if (!isPlainObject(region) || typeof region.type !== 'string') return false;
  if (!REGION_TYPES.has(region.type)) return false;

  switch (region.type) {
    case 'spatial': {
      const shape = region.shape;
      if (!isPlainObject(shape)) return false;
      const origin = shape.origin;
      return (
        typeof shape.kind === 'string' &&
        typeof shape.unit === 'string' &&
        isPlainObject(origin) &&
        typeof origin.x === 'number' &&
        typeof origin.y === 'number'
      );
    }
    case 'temporal': {
      const time = region.time;
      return isPlainObject(time) && typeof time.start === 'string' && typeof time.end === 'string';
    }
    case 'frame': {
      const frame = region.frame;
      return (
        isPlainObject(frame) && typeof frame.start === 'number' && typeof frame.end === 'number'
      );
    }
    case 'textual': {
      const text = region.text;
      if (!isPlainObject(text)) return false;
      const selector = text.selector;
      return isPlainObject(selector) && typeof selector.fragment === 'string';
    }
    case 'identified': {
      const identified = region.identified;
      return (
        isPlainObject(identified) &&
        typeof identified.identifier === 'string' &&
        typeof identified.value === 'string'
      );
    }
    default:
      return false;
  }
}

/**
 * Validates the `region` field from a `POST /matches/byReference` request
 * body. Returns the validated array, `undefined` if the field was omitted,
 * or throws a descriptive `Error` (callers should respond `400`) if present
 * but malformed.
 */
export function parseRegionOfInterest(region: unknown): RegionOfInterest[] | undefined {
  if (region === undefined) return undefined;
  if (!Array.isArray(region)) {
    throw new Error('region must be an array of region-of-interest objects');
  }
  if (!region.every(isValidRegion)) {
    throw new Error(
      'region items must each have a valid "type" (spatial, temporal, frame, textual, or identified) with the matching required fields',
    );
  }
  return region;
}
