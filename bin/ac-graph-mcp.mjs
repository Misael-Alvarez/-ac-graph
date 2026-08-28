#!/usr/bin/env node
import { register } from 'node:module';

register('./hooks.mjs', import.meta.url);

const { serve } = await import('./mcp.ts');
await serve(process.stdin, process.stdout);
