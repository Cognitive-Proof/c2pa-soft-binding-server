import { parseRegionOfInterest } from '../utils/regionOfInterest';

describe('parseRegionOfInterest', () => {
  it('returns undefined when region is omitted', () => {
    expect(parseRegionOfInterest(undefined)).toBeUndefined();
  });

  it('throws when region is not an array', () => {
    expect(() => parseRegionOfInterest({ type: 'frame' })).toThrow(/must be an array/);
  });

  it('throws when an item has an unknown type', () => {
    expect(() => parseRegionOfInterest([{ type: 'bogus' }])).toThrow(/valid "type"/);
  });

  it.each([
    [
      'spatial',
      { type: 'spatial', shape: { kind: 'rectangle', unit: 'pixel', origin: { x: 1, y: 2 } } },
    ],
    ['temporal', { type: 'temporal', time: { start: '00:00', end: '00:10' } }],
    ['frame', { type: 'frame', frame: { start: 0, end: 10 } }],
    ['textual', { type: 'textual', text: { selector: { fragment: 'page=1' } } }],
    ['identified', { type: 'identified', identified: { identifier: 'id', value: 'v' } }],
  ])('accepts a valid %s region', (_label, region) => {
    expect(parseRegionOfInterest([region])).toEqual([region]);
  });

  it('throws when a spatial region is missing required shape fields', () => {
    expect(() =>
      parseRegionOfInterest([{ type: 'spatial', shape: { kind: 'rectangle' } }]),
    ).toThrow(/valid "type"/);
  });
});
