#!/usr/bin/env -S node --experimental-strip-types

import { main } from '../src/index.ts';

main().catch(err => {
  console.error('Fatal DocRouter Error:', err);
  process.exit(1);
});
