#!/usr/bin/env node

import { main } from '../../../dist/apps/cli/src/index.js';

main().catch(err => {
  console.error('Fatal DocOrbit Error:', err);
  process.exit(1);
});
