#!/usr/bin/env node
import path from 'path';
import { spawn } from 'child_process';
import { fetchCapabilities, fetchWellKnown } from './discovery';

interface CliOptions {
  baseUrl?: string;
  token?: string;
  cleanup: boolean;
  json: boolean;
}

function printUsage(): void {
  console.log(`
Usage: softbinding-api-conformance --base-url <url> --token <bearer> [options]

Runs a black-box conformance suite against a C2PA Soft Binding Resolution API
server. This CREATES AND DELETES real data on the target (test manifests and
bindings) — point it at a sandbox/staging deployment, not production.

Required:
  --base-url <url>   Base URL of the target's /v1 API (e.g. https://staging.example.com/v1)
  --token <bearer>    Bearer token with fetch:manifests, store:manifests, and
                       store:bindings scopes

Options:
  --no-cleanup         Leave created fixture manifests in place (for debugging a failure)
  --json               Emit Jest's JSON reporter output instead of the default reporter
  --help               Show this message
`);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { cleanup: true, json: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--base-url':
        options.baseUrl = argv[++i];
        break;
      case '--token':
        options.token = argv[++i];
        break;
      case '--no-cleanup':
        options.cleanup = false;
        break;
      case '--json':
        options.json = true;
        break;
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
        break;
      default:
        console.error(`Unknown argument: ${arg}`);
        printUsage();
        process.exit(1);
    }
  }

  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (!options.baseUrl || !options.token) {
    console.error('Error: --base-url and --token are required.\n');
    printUsage();
    process.exit(1);
    return;
  }

  console.warn(
    '\n⚠  This suite creates and deletes real manifests/bindings on the target server.\n' +
      '   Point it at a sandbox or staging deployment, not production.\n',
  );

  console.log(`Discovering capabilities at ${options.baseUrl}/services/capabilities ...`);
  const capabilities = await fetchCapabilities(options.baseUrl);
  const wellKnown = await fetchWellKnown(options.baseUrl);
  console.log(
    `Supported capabilities: ${capabilities.supportedCapabilities.join(', ') || '(none reported)'}`,
  );
  if (!wellKnown) {
    console.log('(No well-known discovery document found — that suite will report it as missing.)');
  }

  const jestBin = require.resolve('jest/bin/jest');
  const configPath = path.join(__dirname, '..', 'jest.conformance.config.js');
  const jestArgs = ['--config', configPath, ...(options.json ? ['--json'] : [])];

  const child = spawn(process.execPath, [jestBin, ...jestArgs], {
    stdio: 'inherit',
    env: {
      ...process.env,
      CONFORMANCE_BASE_URL: options.baseUrl,
      CONFORMANCE_TOKEN: options.token,
      CONFORMANCE_CLEANUP: String(options.cleanup),
      CONFORMANCE_CAPABILITIES: JSON.stringify(capabilities),
    },
  });

  child.on('exit', (code) => process.exit(code ?? 1));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
