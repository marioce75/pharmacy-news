// Prints a bcrypt hash for ADMIN_PASSWORD_HASH or a reviewer's password_hash.
// Run with: node scripts/create-admin.js
// The password is read from the terminal without echo, so it does not land in shell
// history or the process list. Passing it as an argument still works but is discouraged.

const bcrypt = require('bcrypt');

function prompt(question) {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    if (!input.isTTY) {
      let data = '';
      input.setEncoding('utf8');
      input.on('data', chunk => { data += chunk; });
      input.on('end', () => resolve(data.replace(/\r?\n$/, '')));
      input.on('error', reject);
      return;
    }
    process.stderr.write(question);
    input.setRawMode(true);
    input.resume();
    input.setEncoding('utf8');
    let value = '';
    input.on('data', function onData(ch) {
      if (ch === '\u0003') { input.setRawMode(false); process.exit(130); }
      if (ch === '\r' || ch === '\n' || ch === '\u0004') {
        input.setRawMode(false); input.pause(); input.removeListener('data', onData);
        process.stderr.write('\n'); resolve(value); return;
      }
      if (ch === '\u007f') { value = value.slice(0, -1); return; }
      value += ch;
    });
  });
}

(async () => {
  let password = process.argv[2];
  if (password) console.error('Warning: a password given as an argument can appear in shell history.');
  else {
    password = await prompt('Password: ');
    if (process.stdin.isTTY && password !== await prompt('Repeat password: ')) { console.error('Passwords did not match.'); process.exit(1); }
  }
  if (!password || password.length < 12 || Buffer.byteLength(password, 'utf8') > 72) {
    console.error('Use a password of 12 to 72 bytes.');
    process.exit(1);
  }
  const hash = await bcrypt.hash(password, 12);
  console.log('\nPaste this into ADMIN_PASSWORD_HASH or the reviewer\'s password_hash:\n');
  console.log(hash);
  console.log('');
})();
