import { encode } from '../codec';
import { vsmarkExtractor, VSMARK_ALGORITHM } from '../index';

describe('vsmarkExtractor', () => {
  it('recovers a binding value hidden in watermarked text', async () => {
    const watermarked = encode('binding-value-456', 'An article about provenance.');
    const result = await vsmarkExtractor(Buffer.from(watermarked, 'utf-8'), 'text/plain');

    expect(result).toBe('binding-value-456');
  });

  it('returns null for text containing no watermark', async () => {
    const result = await vsmarkExtractor(
      Buffer.from('Plain text, no watermark.', 'utf-8'),
      'text/plain',
    );

    expect(result).toBeNull();
  });

  it('returns null for non-UTF-8 binary content', async () => {
    const result = await vsmarkExtractor(
      Buffer.from([0xff, 0xfe, 0x00, 0xff]),
      'application/octet-stream',
    );

    expect(result).toBeNull();
  });
});

describe('VSMARK_ALGORITHM', () => {
  it('matches the C2PA algorithm naming convention', () => {
    expect(VSMARK_ALGORITHM).toBe('com.cognitiveproof.vsmark.v1');
  });
});
