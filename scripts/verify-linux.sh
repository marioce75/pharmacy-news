#!/bin/sh
# Run only in a separately authorized disposable Linux checkout; never production storage.
set -eu
[ "$(uname -s)" = Linux ] || { echo 'Linux host required; no Linux result claimed on macOS'; exit 2; }
node scripts/check-runtime.js
npm ci --ignore-scripts --no-audit --no-fund
node -e "const b=require('bcrypt');if(!b.compareSync('fixture',b.hashSync('fixture',4)))process.exit(1);console.log('bcrypt native binding loaded:',process.platform,process.arch,process.versions.node)"
node --test tests/*.test.js
npm audit --package-lock-only --ignore-scripts --audit-level=moderate
echo 'Linux compatibility checks completed; this does not deploy or approve content.'
