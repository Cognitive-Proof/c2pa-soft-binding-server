// Loads a DataStore plugin: either a plugin instance passed directly (e.g. by
// a library consumer), or an npm package name to require() — falling back to
// DATASTORE_PLUGIN and then the bundled MongoDB plugin.

import type { DataStorePlugin } from '@cognitiveproof/softbinding-api-plugin-types';

export type { Match, ManifestEntry, Receipt } from '@cognitiveproof/softbinding-api-plugin-types';

export function loadDataStore(plugin?: DataStorePlugin | string): DataStorePlugin {
  if (plugin && typeof plugin === 'object') return plugin;

  const packageName =
    plugin ?? process.env.DATASTORE_PLUGIN ?? '@cognitiveproof/softbinding-api-plugin-mongodb';

  try {
    return (require(packageName) as { default: DataStorePlugin }).default;
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'MODULE_NOT_FOUND') {
      throw new Error(
        `DataStore plugin "${packageName}" is not installed. Run \`npm install ${packageName}\`.`,
        { cause: err },
      );
    }
    throw err;
  }
}
