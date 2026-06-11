import { promises as dns } from 'dns';
import { validateReferenceUrl } from '../utils/ssrf';

jest.mock('dns', () => ({
  promises: {
    lookup: jest.fn(),
  },
}));

const mockedLookup = dns.lookup as jest.Mock;

describe('validateReferenceUrl', () => {
  beforeEach(() => {
    mockedLookup.mockReset();
  });

  it('rejects non-HTTPS URLs', async () => {
    await expect(validateReferenceUrl('http://example.com/asset.jpg')).rejects.toThrow(
      'Only HTTPS reference URLs are permitted',
    );
    expect(mockedLookup).not.toHaveBeenCalled();
  });

  it('rejects malformed URLs', async () => {
    await expect(validateReferenceUrl('not a url')).rejects.toThrow('Invalid URL format');
  });

  it('rejects URLs whose hostname cannot be resolved', async () => {
    mockedLookup.mockRejectedValue(new Error('ENOTFOUND'));

    await expect(validateReferenceUrl('https://nonexistent.example/asset.jpg')).rejects.toThrow(
      'Could not resolve reference URL hostname',
    );
  });

  it.each([
    ['10.0.0.5'],
    ['172.16.0.1'],
    ['192.168.1.1'],
    ['127.0.0.1'],
    ['169.254.1.1'],
    ['::1'],
  ])('rejects URLs resolving to private/reserved address %s', async address => {
    mockedLookup.mockResolvedValue([{ address, family: address.includes(':') ? 6 : 4 }]);

    await expect(validateReferenceUrl('https://internal.example/asset.jpg')).rejects.toThrow(
      'Reference URL resolves to a private or reserved IP address',
    );
  });

  it('allows HTTPS URLs resolving to public addresses', async () => {
    mockedLookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);

    await expect(validateReferenceUrl('https://example.com/asset.jpg')).resolves.toBeUndefined();
  });
});
