const bcrypt = require('bcrypt');
const reviewers = require('../lib/reviewers');

// The single env-configured administrator keeps its editorial, evidence and rights
// duties but is never a clinical identity.
const LEGACY_ROLES = ['editor', 'evidence_reviewer', 'rights_reviewer'];
const MAX_REAUTH_FAILURES = 5;
let equalizer = null;

function requireAdmin(req, res, next) {
  if (identity(req.session)) return next();
  return res.redirect('/admin/login');
}

function requireAdminApi(req, res, next) {
  if (identity(req.session)) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

function validInput(username, password) {
  return typeof username === 'string' && typeof password === 'string' && username.length <= 128 && Buffer.byteLength(password, 'utf8') <= 72;
}

function registryAccount(username) {
  try { return reviewers.find(username); }
  catch (err) {
    // Fail closed without logging paths, hashes or file contents.
    console.error('[AUTH] Reviewer registry unavailable:', err.code || 'error');
    return null;
  }
}

// Returns {source, id, credential} for a valid login, otherwise null. Exactly one
// bcrypt comparison runs per attempt so timing does not reveal which accounts exist.
async function authenticate(username, password) {
  if (!validInput(username, password)) return null;
  const account = registryAccount(username);
  if (account) {
    const ok = await bcrypt.compare(password, account.password_hash).catch(() => false);
    return ok && !account.disabled ? { source: 'registry', id: account.id, credential: reviewers.credentialDigest(account.password_hash) } : null;
  }
  const expectedUser = process.env.ADMIN_USERNAME;
  const expectedHash = process.env.ADMIN_PASSWORD_HASH;
  if (expectedUser && expectedHash && username === expectedUser) {
    const ok = await bcrypt.compare(password, expectedHash).catch(() => false);
    return ok ? { source: 'legacy_admin', id: expectedUser, credential: reviewers.credentialDigest(expectedHash) } : null;
  }
  // Spend comparable bcrypt work so response timing does not reveal the configured username.
  if (!expectedHash && !equalizer) equalizer = bcrypt.hashSync(require('crypto').randomBytes(16).toString('hex'), 12);
  await bcrypt.compare(password, expectedHash || equalizer).catch(() => false);
  return null;
}

async function verifyCredentials(username, password) {
  return (await authenticate(username, password)) !== null;
}

function establish(session, login) {
  session.authenticated = true;
  session.username = login.id;
  session.account_source = login.source;
  session.credential = login.credential;
  session.reauth_failures = 0;
}

// Roles and clinical status are re-read from server configuration on every request;
// nothing a browser sends can add a role, and disabling an account or changing its
// password ends existing sessions.
function identity(session) {
  if (!session?.authenticated || typeof session.username !== 'string' || !session.username) return null;
  if (session.account_source === 'registry') {
    const account = registryAccount(session.username);
    if (!account || account.disabled || session.credential !== reviewers.credentialDigest(account.password_hash)) return null;
    const credential = reviewers.credentialStatus(account);
    return {
      id: account.id, displayName: account.display_name, type: 'human', authenticated: true, source: 'registry', roles: [...account.roles],
      clinicalCredentialVerified: credential.verified === true, credential: credential.verified ? credential.summary : null,
      credentialDigest: credential.verified ? credential.digest : null, credentialIssue: credential.verified ? null : credential.reason
    };
  }
  // Existing login verifies one configured administrator. It does not verify
  // professional credentials or a second independent clinical identity.
  const expectedHash = process.env.ADMIN_PASSWORD_HASH;
  if (session.account_source !== 'legacy_admin' || !process.env.ADMIN_USERNAME || session.username !== process.env.ADMIN_USERNAME || !expectedHash || session.credential !== reviewers.credentialDigest(expectedHash)) return null;
  return { id: session.username, displayName: session.username, type: 'human', authenticated: true, source: 'legacy_admin', roles: [...LEGACY_ROLES], clinicalCredentialVerified: false, credential: null, credentialDigest: null, credentialIssue: 'The shared administrator login cannot hold a clinical credential' };
}

// Step-up check for signing an approval: the signed-in reviewer re-enters their own
// password. Repeated failures lock approvals for this session until a fresh login.
async function reauthenticate(session, password) {
  const principal = identity(session);
  if (!principal || (session.reauth_failures || 0) >= MAX_REAUTH_FAILURES) return null;
  const hash = principal.source === 'registry' ? registryAccount(principal.id)?.password_hash : process.env.ADMIN_PASSWORD_HASH;
  const ok = hash && validInput(principal.id, password) && await bcrypt.compare(password, hash).catch(() => false);
  if (!ok) { session.reauth_failures = (session.reauth_failures || 0) + 1; return null; }
  session.reauth_failures = 0;
  return { ...principal, stepUp: true };
}

module.exports = { requireAdmin, requireAdminApi, verifyCredentials, authenticate, establish, identity, reauthenticate, LEGACY_ROLES };
