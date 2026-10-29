#!/usr/bin/env node
'use strict';
const expected = require('../package.json').engines.node;
function checkRuntime(actual = process.versions.node) {
  if (actual !== expected) throw new Error(`Node ${expected} is required; running ${actual}. Check Render NODE_VERSION override before building. No migration was run.`);
  return expected;
}
if (require.main === module) {
  try { console.log(`Runtime verified: Node ${checkRuntime()}`); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { checkRuntime };
