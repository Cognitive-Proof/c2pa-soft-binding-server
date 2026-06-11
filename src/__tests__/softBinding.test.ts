import { createSoftBindingRegistry } from '../softBinding';

describe('createSoftBindingRegistry', () => {
  it('returns empty supported algorithms when no extractors are registered', () => {
    const registry = createSoftBindingRegistry();

    expect(registry.getSupportedAlgorithms()).toEqual({ watermarks: [], fingerprints: [] });
  });

  it('registers extractors passed to the factory and categorizes by name', async () => {
    const watermarkExtractor = jest.fn().mockResolvedValue('d2F0ZXJtYXJr');
    const fingerprintExtractor = jest.fn().mockResolvedValue('ZmluZ2VycHJpbnQ=');

    const registry = createSoftBindingRegistry({
      'com.example.watermark.v1': watermarkExtractor,
      'com.example.fingerprint.v1': fingerprintExtractor,
    });

    expect(registry.getSupportedAlgorithms()).toEqual({
      watermarks: [{ alg: 'com.example.watermark.v1' }],
      fingerprints: [{ alg: 'com.example.fingerprint.v1' }],
    });

    const buffer = Buffer.from('asset-bytes');
    const result = await registry.extractSoftBinding(
      buffer,
      'image/png',
      'com.example.watermark.v1',
    );

    expect(result).toBe('d2F0ZXJtYXJr');
    expect(watermarkExtractor).toHaveBeenCalledWith(buffer, 'image/png');
  });

  it('returns null when extracting with an unregistered algorithm', async () => {
    const registry = createSoftBindingRegistry();

    const result = await registry.extractSoftBinding(Buffer.from('x'), 'image/png', 'unknown.alg');

    expect(result).toBeNull();
  });

  it('supports registering extractors after creation via registerExtractor', () => {
    const registry = createSoftBindingRegistry();

    registry.registerExtractor('com.example.watermark.v2', async () => null);

    expect(registry.getSupportedAlgorithms().watermarks).toEqual([
      { alg: 'com.example.watermark.v2' },
    ]);
  });
});
