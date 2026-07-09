import { execSync } from 'child_process';
import pkg from '../package.json';

function publishedVersion(name: string): string | undefined {
  try {
    return execSync(`npm view ${name} version`, { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    // Package has never been published, or the registry lookup failed —
    // either way, fall through and attempt the publish.
    return undefined;
  }
}

const current = publishedVersion(pkg.name);

if (current === pkg.version) {
  console.log(`${pkg.name}@${pkg.version} is already published on npm — skipping.`);
} else {
  console.log(`Publishing ${pkg.name}@${pkg.version} (registry has ${current ?? 'nothing'})...`);
  execSync('npm publish --access public', { stdio: 'inherit' });
}
