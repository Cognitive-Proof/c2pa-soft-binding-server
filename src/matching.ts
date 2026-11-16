// Routes soft-binding queries and index updates to the right backend: a
// MatcherPlugin registered for the query's algorithm, else the data store's
// exact-value lookup.

import type {
  DataStorePlugin,
  Logger,
  Match,
  MatcherPlugin,
  SoftBindingBlock,
} from '@cognitiveproof/softbinding-api-plugin-types';

export type Matchers = Record<string, MatcherPlugin>;

/** True for an InvalidSoftBindingValueError from any copy of the types package. */
export function isInvalidSoftBindingValue(err: unknown): err is Error {
  return err instanceof Error && err.name === 'InvalidSoftBindingValueError';
}

/**
 * Finds manifests for a soft binding value: through the matcher registered
 * for `alg`, or the data store when there is none (or no `alg` is given).
 */
export function findMatches(
  dataStore: DataStorePlugin,
  matchers: Matchers,
  alg: string | undefined,
  value: string,
  maxResults: number,
): Promise<Match[]> {
  const matcher = alg ? matchers[alg] : undefined;
  return matcher ? matcher.match(value, maxResults) : dataStore.findByBinding(value, maxResults);
}

/**
 * Indexes a stored manifest's soft-binding blocks with the matchers for their
 * algorithms. Blocks with no matcher are left alone: they're associated
 * through `POST /bindings` as before. On failure, whatever was indexed is
 * removed again and the error rethrown.
 */
export async function indexManifestBindings(
  matchers: Matchers,
  manifestId: string,
  bindings: SoftBindingBlock[],
): Promise<void> {
  const used = new Set<MatcherPlugin>();
  try {
    for (const block of bindings) {
      const matcher = matchers[block.alg];
      if (!matcher) continue;
      used.add(matcher);
      await matcher.index(manifestId, block.value, block.scope);
    }
  } catch (err) {
    await Promise.allSettled([...used].map((matcher) => matcher.remove(manifestId)));
    throw err;
  }
}

/** Removes a deleted manifest from every matcher; failures are logged, not thrown. */
export async function removeFromMatchers(
  matchers: Matchers,
  manifestId: string,
  logger?: Logger,
): Promise<void> {
  const results = await Promise.allSettled(
    Object.values(matchers).map((matcher) => matcher.remove(manifestId)),
  );
  for (const result of results) {
    if (result.status === 'rejected') {
      logger?.error('Failed to remove a deleted manifest from a matcher index', {
        manifestId,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    }
  }
}
