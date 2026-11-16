import {
  InvalidSoftBindingValueError,
  type Match,
  type MatcherPlugin,
} from '@cognitiveproof/softbinding-api-plugin-types';

/**
 * In-memory MatcherPlugin for route tests: matches values that share a
 * prefix of at least 4 characters, scored by prefix length. Values starting
 * with `!` are invalid.
 */
export function createFakeMatcher(
  kind: MatcherPlugin['kind'] = 'fingerprint',
): MatcherPlugin & { entries: Map<string, string[]> } {
  const entries = new Map<string, string[]>();

  function check(value: string) {
    if (value.startsWith('!')) throw new InvalidSoftBindingValueError(`bad value ${value}`);
  }

  return {
    kind,
    entries,
    async index(manifestId, value) {
      check(value);
      entries.set(manifestId, [...(entries.get(manifestId) ?? []), value]);
    },
    async remove(manifestId) {
      entries.delete(manifestId);
    },
    async match(value, maxResults) {
      check(value);
      const matches: Match[] = [];
      for (const [manifestId, values] of entries) {
        const best = Math.max(
          ...values.map((stored) => {
            let n = 0;
            while (n < stored.length && stored[n] === value[n]) n++;
            return n;
          }),
        );
        if (best >= 4) matches.push({ manifestId, similarityScore: Math.min(100, best * 10) });
      }
      return matches.sort((a, b) => b.similarityScore - a.similarityScore).slice(0, maxResults);
    },
  };
}
