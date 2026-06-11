import { encode, decode } from '../codec';

describe('encode/decode', () => {
  it('round-trips a hidden message', () => {
    const carrier = 'This is a sample article about cats and dogs.';
    const watermarked = encode('manifest-binding-value-123', carrier);

    expect(decode(watermarked)).toBe('manifest-binding-value-123');
  });

  it('keeps the carrier text visually unchanged', () => {
    const carrier = 'This is a sample article about cats and dogs.';
    const watermarked = encode('hidden', carrier);

    // Stripping variation selectors restores the original carrier text.
    const visible = [...watermarked]
      .filter((char) => {
        const cp = char.codePointAt(0)!;
        const isVariationSelector =
          (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef);
        return !isVariationSelector;
      })
      .join('');

    expect(visible).toBe(carrier);
  });

  it('returns undefined when no watermark is present', () => {
    expect(decode('Just plain text with no hidden message.')).toBeUndefined();
  });

  it('returns the cleaned carrier unchanged if it is too short to carry the message', () => {
    const carrier = 'short';
    const watermarked = encode('a much longer secret message than the carrier', carrier);

    expect(watermarked).toBe(carrier);
    expect(decode(watermarked)).toBeUndefined();
  });

  it('throws if the secret message exceeds the maximum size', () => {
    const tooLong = 'x'.repeat(65536);
    expect(() => encode(tooLong, 'carrier text')).toThrow(/exceeds maximum size/);
  });

  it('rejects a watermark with a corrupted CRC', () => {
    const watermarked = encode('hello', 'This is a longer carrier sentence for testing purposes.');
    // Flip a payload byte by replacing one of the variation selectors with a different one.
    const chars = [...watermarked];
    const corruptedIndex = chars.findIndex((char) => {
      const cp = char.codePointAt(0)!;
      return cp >= 0xfe00 && cp <= 0xfe0f;
    });
    chars[corruptedIndex] = String.fromCodePoint(
      0xfe0f - (chars[corruptedIndex].codePointAt(0)! - 0xfe00),
    );
    const corrupted = chars.join('');

    expect(decode(corrupted)).toBeUndefined();
  });
});
