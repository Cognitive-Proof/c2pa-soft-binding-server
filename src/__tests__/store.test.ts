import type {
  DataStorePlugin,
  ObjectStorePlugin,
} from '@cognitiveproof/softbinding-api-plugin-types';
import { loadDataStore } from '../store';
import { loadObjectStore } from '../objectStore';
import { createFakeDataStore } from './helpers/fakeDataStore';

describe('loadDataStore', () => {
  it('returns a plugin instance passed directly', () => {
    const plugin = createFakeDataStore();

    expect(loadDataStore(plugin)).toBe(plugin);
  });

  it('loads a plugin by package name', () => {
    const plugin = loadDataStore('@cognitiveproof/softbinding-api-plugin-sqlite');

    expect(typeof (plugin as DataStorePlugin).findByBinding).toBe('function');
  });

  it('throws a helpful error when the package is not installed', () => {
    expect(() => loadDataStore('@cognitiveproof/does-not-exist')).toThrow(
      'DataStore plugin "@cognitiveproof/does-not-exist" is not installed. Run `npm install @cognitiveproof/does-not-exist`.',
    );
  });
});

describe('loadObjectStore', () => {
  it('returns a plugin instance passed directly', () => {
    const plugin = {} as ObjectStorePlugin;

    expect(loadObjectStore(plugin)).toBe(plugin);
  });

  it('throws a helpful error when the package is not installed', () => {
    expect(() => loadObjectStore('@cognitiveproof/does-not-exist')).toThrow(
      'ObjectStore plugin "@cognitiveproof/does-not-exist" is not installed. Run `npm install @cognitiveproof/does-not-exist`.',
    );
  });
});
