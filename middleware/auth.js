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
  if (!expectedUser || !expectedHash) return false;
  if (username !== expectedUser) return false;
  try {
    return await bcrypt.compare(password, expectedHash);
  } catch {
    return false;
  }
}

module.exports = { requireAdmin, requireAdminApi, verifyCredentials };
