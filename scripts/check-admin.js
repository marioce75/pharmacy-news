// Verify a password against a bcrypt hash.
// Usage:
//   node scripts/check-admin.js <password> <hash>
//   node scripts/check-admin.js <password>            # uses ADMIN_PASSWORD_HASH from .env

require('dotenv').config();
const bcrypt = require('bcrypt');

const password = process.argv[2];
const hash = process.argv[3] || process.env.ADMIN_PASSWORD_HASH;

if (!password) {
  console.error('Usage: node scripts/check-admin.js <password> [hash]');
  process.exit(1);
}
if (!hash) {
  console.error('No hash provided and ADMIN_PASSWORD_HASH not set in .env');
  process.exit(1);
}

console.log('hash length:', hash.length, '(must be 60 for valid bcrypt)');
console.log('hash prefix:', hash.slice(0, 7));

bcrypt.compare(password, hash).then((ok) => {
  console.log('match:', ok ? 'YES ✓' : 'NO ✗');
  process.exit(ok ? 0 : 2);
}).catch((err) => {
  console.error('bcrypt error:', err.message);
  process.exit(3);
});
