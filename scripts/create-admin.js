// Run with: node scripts/create-admin.js <your-password>
// Prints the bcrypt hash to paste into ADMIN_PASSWORD_HASH env var.

const bcrypt = require('bcrypt');

const password = process.argv[2];
if (!password) {
  console.error('Usage: node scripts/create-admin.js <password>');
  process.exit(1);
}

bcrypt.hash(password, 12).then((hash) => {
  console.log('\nPaste this into your ADMIN_PASSWORD_HASH env var:\n');
  console.log(hash);
  console.log('');
});
