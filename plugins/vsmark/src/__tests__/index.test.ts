import { encode, encodeRepeated } from '../codec';
import { vsmarkExtractor, VSMARK_ALGORITHM } from '../index';

describe('vsmarkExtractor', () => {
  it('recovers a binding value hidden in watermarked text', async () => {
    const watermarked = encode('binding-value-456', 'An article about provenance.');
    const result = await vsmarkExtractor(Buffer.from(watermarked, 'utf-8'), 'text/plain');

    expect(result).toBe('binding-value-456');
  });

  it('recovers a UUID from any 93-character excerpt of repeat-encoded text', async () => {
    const uuid = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
    const article = 'Provenance matters for every quoted sentence in this article. '.repeat(20);
    const chars = [...encodeRepeated(uuid, article)];

    // Each carrier character is followed by one variation selector, so an
    // excerpt of N visible characters is 2N code points. Try every offset in
    // the middle of the text, including ones that split a block.
    for (let start = 400; start < 400 + 2 * 47; start += 2) {
      const excerpt = chars.slice(start, start + 2 * 93).join('');
      const result = await vsmarkExtractor(Buffer.from(excerpt, 'utf-8'), 'text/plain');
      expect(result).toBe(uuid);
    }
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
