// Loads an ObjectStore plugin: either a plugin instance passed directly (e.g.
// by a library consumer), or an npm package name to require() — falling back
// to OBJECTSTORE_PLUGIN and then the bundled GCS plugin.
//
// createServer() does not call this automatically — no bundled route
// currently depends on blob storage. It's exported for consumers building
// custom routes that need a configured ObjectStorePlugin.

import type { ObjectStorePlugin } from '@cognitiveproof/softbinding-api-plugin-types';

export type { LoadedData } from '@cognitiveproof/softbinding-api-plugin-types';

export function loadObjectStore(plugin?: ObjectStorePlugin | string): ObjectStorePlugin {
  if (plugin && typeof plugin === 'object') return plugin;

  const packageName =
    plugin ?? process.env.OBJECTSTORE_PLUGIN ?? '@cognitiveproof/softbinding-api-plugin-gcp-bucket';

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return (require(packageName) as { default: ObjectStorePlugin }).default;
  } catch (err) {
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND') {
      throw new Error(
        `ObjectStore plugin "${packageName}" is not installed. Run \`npm install ${packageName}\`.`,
      );
    }
    throw err;
  }
}
