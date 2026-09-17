#!/usr/bin/env node
// Browser polyfills must be installed synchronously before any core module loads.
import './polyfill.mjs'

await import('./src/mcp.ts')
