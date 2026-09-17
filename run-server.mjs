#!/usr/bin/env node
import './polyfill.mjs'

await import('./src/server.ts')
