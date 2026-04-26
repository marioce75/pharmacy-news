const bcrypt = require('bcrypt');

function requireAdmin(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  return res.redirect('/admin/login');
}

function requireAdminApi(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

async function verifyCredentials(username, password) {
  const expectedUser = process.env.ADMIN_USERNAME;
  const expectedHash = process.env.ADMIN_PASSWORD_HASH;
  const debug = process.env.AUTH_DEBUG === '1';

  function log(reason, extra) {
    if (!debug) return;
    const safe = {
      reason,
      username_provided_len: (username || '').length,
      password_provided_len: (password || '').length,
      env_user_set: !!expectedUser,
      env_user_len: (expectedUser || '').length,
      username_matches: username === expectedUser,
      env_hash_set: !!expectedHash,
      env_hash_len: (expectedHash || '').length,
      env_hash_prefix: expectedHash ? expectedHash.slice(0, 4) : null,
      ...(extra || {})
    };
    console.log('[AUTH]', JSON.stringify(safe));
  }

  if (!expectedUser || !expectedHash) {
    log('missing-env');
    return false;
  }
  if (username !== expectedUser) {
    log('username-mismatch');
    return false;
  }
  try {
    const ok = await bcrypt.compare(password, expectedHash);
    log(ok ? 'success' : 'bcrypt-mismatch', { bcrypt_result: ok });
    return ok;
  } catch (err) {
    log('bcrypt-error', { error_message: err && err.message });
    return false;
  }
}

module.exports = { requireAdmin, requireAdminApi, verifyCredentials };
