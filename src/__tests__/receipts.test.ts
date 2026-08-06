import { buildReceipt, verifyReceipt } from '../receipts';

describe('buildReceipt', () => {
  it('omits anchor.parameters when not supplied', () => {
    const receipt = buildReceipt('manifest-1', 'https://repo.example.com', 'secret');

    expect(receipt.anchor.parameters).toBeUndefined();
  });

  it('includes anchor.parameters when supplied', () => {
    const receipt = buildReceipt('manifest-1', 'https://repo.example.com', 'secret', {
      view: 'verification',
    });

    expect(receipt.anchor.parameters).toEqual({ view: 'verification' });
  });

  it('remains verifiable with anchor.parameters set, since parameters are not part of the signed payload', () => {
    const receipt = buildReceipt('manifest-1', 'https://repo.example.com', 'secret', {
      view: 'verification',
    });

    expect(verifyReceipt(receipt, 'secret')).toBe(true);
  });
});
