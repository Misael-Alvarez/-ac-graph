#!/usr/bin/env node
import { register } from 'node:module';

register('./hooks.mjs', import.meta.url);

// Imported dynamically so the hooks above are in place before the CLI — and
// therefore the whole library behind it — is resolved.
const { main } = await import('./cli.ts');
process.exitCode = await main(process.argv.slice(2));
