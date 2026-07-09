function createFileMock() {
  let finishHandler: (() => void) | undefined;

  return {
    createWriteStream: jest.fn(() => ({
      on: jest.fn((event: string, cb: () => void) => {
        if (event === 'finish') finishHandler = cb;
      }),
      end: jest.fn(() => finishHandler?.()),
    })),
    getMetadata: jest.fn((): Promise<[{ contentType?: string; timeCreated?: string }]> =>
      Promise.resolve([{ contentType: 'application/octet-stream' }]),
    ),
    download: jest.fn((): Promise<[Buffer]> => Promise.resolve([Buffer.from('data')])),
    exists: jest.fn((): Promise<[boolean]> => Promise.resolve([true])),
    getSignedUrl: jest.fn((): Promise<[string]> =>
      Promise.resolve(['https://signed.example.com/object']),
    ),
    delete: jest.fn((): Promise<unknown> => Promise.resolve(undefined)),
  };
}

export function createBucketMock(name: string) {
  const fileMock = createFileMock();
  return {
    name,
    fileMock,
    file: jest.fn(() => fileMock),
    getFiles: jest.fn((): Promise<[unknown[]]> => Promise.resolve([[]])),
  };
}
