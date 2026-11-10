'use strict';
// Regression tests for the 2026-11-10 security hotfix:
//   1. a calculator id is validated against the exact CALCULATORS allowlist before any path is
//      built or any file is touched (approval, withdrawal, status);
//   2. the clinical approval and withdrawal forms post (never GET) when the page script does
//      not run, so a password cannot end up in an address or the access log;
//   3. the access log masks credential-like query values.
// Synthetic accounts, a per-run random password and a temporary content directory only.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises'), fsSync = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { spawn } = require('child_process'), { once } = require('events');
const root = fsSync.mkdtempSync(path.join(os.tmpdir(), 'pharmacy-hotfix-'));
process.env.CONTENT_DIR = root;
for (const k of ['ALLOW_COLLECTION', 'RUN_SCHEDULED_JOBS', 'RUN_NEWS_SCHEDULE', 'ALLOW_MODEL_CALLS', 'ADMIN_USERNAME', 'ADMIN_PASSWORD_HASH']) delete process.env[k];
const password = 'synthetic-' + crypto.randomBytes(9).toString('base64url'), hash = require('bcrypt').hashSync(password, 4);
const registryFile = path.join(root, 'reviewers.json');
fsSync.writeFileSync(registryFile, JSON.stringify({ reviewers: [
  { id: 'fixture-editor', display_name: 'Fixture Editor (synthetic)', password_hash: hash, roles: ['editor'] },
  { id: 'fixture-clinician', display_name: 'Fixture Clinician (synthetic)', password_hash: hash, roles: ['clinical_reviewer'],
    clinical_credential: { profession: 'Synthetic', jurisdiction: 'Synthetic', license_reference: 'SYNTHETIC', verification_url: 'https://example.org/synthetic', verified_by: 'Synthetic verifier', verified_at: '2026-01-01', expires_at: '2099-01-01' } }
] }), { mode: 0o600 });
process.env.REVIEWER_REGISTRY_FILE = registryFile;

const express = require('express');
const tools = require('../lib/clinical-tools');
const { CALCULATORS } = require('../lib/clinical/calculators');
const IDS = CALCULATORS.map(c => c.id);
const cwd = path.join(__dirname, '..');
let server, url;
const sessions = {};

before(async () => {
  await require('../lib/store').ensureDirectories();
  const app = express();
  app.set('view engine', 'ejs'); app.set('views', path.join(cwd, 'views'));
  app.use(require('../middleware/security').headers);
  app.use(express.json()); app.use(express.urlencoded({ extended: false }));
  app.use((req, res, next) => { const as = req.get('x-fixture-as'); req.session = as ? (sessions[as] ||= { authenticated: true, username: as, account_source: 'registry', credential: require('../lib/reviewers').credentialDigest(hash) }) : {}; next(); });
  app.use((req, res, next) => { res.locals.categories = require('../config/categories').CATEGORIES; next(); });
  const site = require('../routes/site');
  app.use('/', site.publicRouter); app.use('/admin', site.adminRouter);
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  url = 'http://127.0.0.1:' + server.address().port;
});
after(async () => { await new Promise(r => server.close(r)); await fs.rm(root, { recursive: true, force: true }); });

const editor = () => ({ 'x-fixture-as': 'fixture-editor', origin: url });
const clinician = () => ({ 'x-fixture-as': 'fixture-clinician', origin: url });
const JSON_TYPE = { 'content-type': 'application/json' };
const post = (p, headers, body) => fetch(url + p, { method: 'POST', redirect: 'manual', headers, body });
const formBody = fields => new URLSearchParams(fields);
const ATTEST = { formulaChecked: 'on', citationsChecked: 'on', testCasesChecked: 'on' };
const digestOf = async id => (await tools.status(id)).version_digest;
// Every file under the temporary content directory with its exact bytes.
async function snapshot(dir = root, out = {}) {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) await snapshot(p, out); else out[path.relative(root, p)] = await fs.readFile(p, 'utf8'); }
  return out;
}
// Synthetic files a traversal would reach: one above the clinical directory, one beside the approvals directory.
async function plant() {
  const victims = { 'victim.json': { synthetic: 'outside clinical content' }, 'clinical-tools/victim.json': { synthetic: 'beside approvals' }, 'pending/victim.json': { synthetic: 'pending record' } };
  for (const [rel, data] of Object.entries(victims)) { await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true }); await fs.writeFile(path.join(root, rel), JSON.stringify(data)); }
  await fs.mkdir(path.join(root, 'clinical-tools', 'approvals'), { recursive: true });
}
const HOSTILE = ['../../victim', '../victim', '../../pending/victim', '..%2F..%2Fvictim', '%2e%2e%2f%2e%2e%2fvictim', '..\\..\\victim', 'approvals/../../victim', '/victim', 'bsa-mosteller/../../../victim', 'bsa-mosteller/', 'bsa-mosteller.json', 'bsa-mosteller\0', 'bsa-mosteller\n', ' bsa-mosteller', 'BSA-MOSTELLER', '.', '..', ''];
const NOT_TOOLS = ['nonexistent-tool', 'extravasation', 'bugs-and-drugs', '__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty', 'valueOf', 'length', '0'];
const NON_STRINGS = [null, undefined, 0, 5, true, ['bsa-mosteller'], { id: 'bsa-mosteller' }, { toString: () => 'bsa-mosteller' }];
const editorPrincipal = { id: 'ed', type: 'human', authenticated: true, roles: ['editor'], clinicalCredentialVerified: false, stepUp: true };
const clinicianPrincipal = { id: 'synthetic-clinician', type: 'human', authenticated: true, roles: ['clinical_reviewer'], clinicalCredentialVerified: true, credential: { profession: 'Synthetic' }, credentialDigest: 'd', stepUp: true };
const OK = { formulaChecked: true, citationsChecked: true, testCasesChecked: true };

test('library: only exact CALCULATORS ids are tools; hostile, unknown, inherited-property and non-string ids touch no file', async () => {
  await plant();
  const beforeFiles = await snapshot();
  for (const id of IDS) assert.equal(tools.known(id), true, id);
  for (const id of [...HOSTILE, ...NOT_TOOLS, ...NON_STRINGS]) {
    const label = JSON.stringify(String(id));
    assert.equal(tools.known(id), false, label);
    assert.equal(await tools.status(id), null, label);
    await assert.rejects(tools.withdraw(id, editorPrincipal, 'Synthetic traversal attempt'), e => e.status === 404 && /Unknown tool/.test(e.message), 'withdraw ' + label);
    await assert.rejects(tools.approve(id, 'f'.repeat(64), clinicianPrincipal, OK), e => e.status === 404 && /Unknown tool/.test(e.message), 'approve ' + label);
  }
  assert.deepEqual(await snapshot(), beforeFiles, 'no file was created, rewritten or audited');
});

test('routes: encoded traversal ids on withdrawal, approval and preview are refused before any file access', async () => {
  await plant();
  const beforeFiles = await snapshot();
  const encoded = ['..%2F..%2Fvictim', '..%2Fvictim', '..%2F..%2Fpending%2Fvictim', '%2E%2E%2F%2E%2E%2Fvictim', '..%5C..%5Cvictim', '..%252F..%252Fvictim', 'bsa-mosteller%2F..%2F..%2F..%2Fvictim', 'bsa-mosteller%00', '__proto__', 'constructor', 'nonexistent-tool'];
  for (const id of encoded) {
    const w = await post('/admin/tools/' + id + '/withdraw', { ...editor(), ...JSON_TYPE }, JSON.stringify({ reason: 'Synthetic traversal attempt' }));
    assert.equal(w.status, 404, 'withdraw ' + id); assert.deepEqual(await w.json(), { error: 'Unknown tool' });
    const wf = await post('/admin/tools/' + id + '/withdraw', editor(), formBody({ reason: 'Synthetic traversal attempt' }));
    assert.equal(wf.status, 404, 'form withdraw ' + id);
    const a = await post('/admin/tools/' + id + '/approve', { ...clinician(), ...JSON_TYPE }, JSON.stringify({ version_digest: 'f'.repeat(64), password, attestation: OK }));
    assert.equal(a.status, 404, 'approve ' + id);
    assert.equal((await fetch(url + '/admin/tools/' + id + '/preview', { headers: editor() })).status, 404, 'preview ' + id);
    assert.equal((await fetch(url + '/tools/' + id)).status, 404, 'public ' + id);
  }
  assert.deepEqual(await snapshot(), beforeFiles, 'files outside and inside the clinical directory are byte-identical');
});

test('review page: all four approval forms and all four withdrawal forms declare method=post and their exact action', async () => {
  const res = await fetch(url + '/admin/tools', { headers: editor() }); assert.equal(res.status, 200);
  const html = await res.text(), forms = html.match(/<form\b[^>]*>/g) || [];
  const attr = (tag, name) => new RegExp('\\s' + name + '="([^"]*)"').exec(tag)?.[1];
  const approve = forms.filter(f => /data-tool-approve=/.test(f)), withdraw = forms.filter(f => /data-tool-withdraw=/.test(f));
  assert.equal(IDS.length, 4); assert.equal(approve.length, 4); assert.equal(withdraw.length, 4);
  for (const f of forms) assert.equal((attr(f, 'method') || 'get').toLowerCase(), 'post', 'a form without method=post would submit by GET: ' + f);
  assert.deepEqual(approve.map(f => attr(f, 'action')), IDS.map(id => '/admin/tools/' + id + '/approve'));
  assert.deepEqual(withdraw.map(f => attr(f, 'action')), IDS.map(id => '/admin/tools/' + id + '/withdraw'));
  // Each approval form carries the digest it signs, so a plain form post names the exact version.
  for (const id of IDS) assert.ok(html.includes(`<input type="hidden" name="version_digest" value="${await digestOf(id)}">`), id);
  assert.equal((html.match(/type="password"/g) || []).length, 4);
});

test('a GET carrying a password is never an approval: nothing is recorded', async () => {
  for (const id of IDS) {
    const q = new URLSearchParams({ ...ATTEST, password, version_digest: await digestOf(id) });
    const r = await fetch(url + '/admin/tools/' + id + '/approve?' + q, { headers: clinician(), redirect: 'manual' });
    assert.equal(r.status, 404, id);
    assert.equal((await tools.status(id)).state, 'awaiting_clinical_review', id);
  }
});

test('script-free flow: a plain form post approves and withdraws with every gate intact', async () => {
  const id = 'ideal-body-weight-devine', digest = await digestOf(id), target = '/admin/tools/' + id + '/approve';
  const send = (who, fields) => post(target, who, formBody(fields));
  // Unticked attestation, wrong password, stale digest, non-clinical account: all refused, nothing recorded.
  const partial = await send(clinician(), { formulaChecked: 'on', citationsChecked: 'on', password, version_digest: digest });
  assert.equal(partial.status, 422); assert.match(await partial.text(), /Nothing was recorded/);
  assert.equal((await send(clinician(), { ...ATTEST, password: 'wrong-' + password, version_digest: digest })).status, 401);
  assert.equal((await send(clinician(), { ...ATTEST, password, version_digest: 'f'.repeat(64) })).status, 409);
  assert.equal((await send(clinician(), { ...ATTEST, password })).status, 409);
  assert.equal((await send(editor(), { ...ATTEST, password, version_digest: digest })).status, 403);
  assert.equal((await tools.status(id)).available, false);
  // The verified clinical reviewer with the right password and all three attestations succeeds.
  const ok = await send(clinician(), { ...ATTEST, password, version_digest: digest });
  assert.equal(ok.status, 303); assert.equal(ok.headers.get('location'), '/admin/tools');
  const s = await tools.status(id); assert.equal(s.state, 'clinically_reviewed'); assert.equal(s.available, true);
  const record = JSON.parse(await fs.readFile(path.join(root, 'clinical-tools', 'approvals', id + '.json'), 'utf8'));
  assert.equal(record.approved_by, 'fixture-clinician'); assert.equal(record.version_digest, digest); assert.ok(!JSON.stringify(record).includes(password));
  // Withdrawal by plain form post: reason required, then recorded.
  assert.equal((await post('/admin/tools/' + id + '/withdraw', editor(), formBody({ reason: '' }))).status, 422);
  const w = await post('/admin/tools/' + id + '/withdraw', editor(), formBody({ reason: 'Synthetic withdrawal' }));
  assert.equal(w.status, 303); assert.equal((await tools.status(id)).state, 'withdrawn');
});

test('scripted flow is unchanged: JSON approval and withdrawal still work and answer in JSON', async () => {
  const id = 'bsa-mosteller', digest = await digestOf(id);
  const body = (pw, extra = {}) => JSON.stringify({ version_digest: digest, password: pw, attestation: OK, ...extra });
  const wrong = await post('/admin/tools/' + id + '/approve', { ...clinician(), ...JSON_TYPE }, body('wrong-' + password));
  assert.equal(wrong.status, 401); assert.match((await wrong.json()).error, /Re-enter your own password/);
  // Form-style checkbox fields in a JSON request are not an attestation.
  assert.equal((await post('/admin/tools/' + id + '/approve', { ...clinician(), ...JSON_TYPE }, JSON.stringify({ version_digest: digest, password, ...ATTEST }))).status, 422);
  const ok = await post('/admin/tools/' + id + '/approve', { ...clinician(), ...JSON_TYPE }, body(password));
  assert.equal(ok.status, 200); assert.equal((await ok.json()).state, 'clinically_reviewed');
  const w = await post('/admin/tools/' + id + '/withdraw', { ...editor(), ...JSON_TYPE }, JSON.stringify({ reason: 'Synthetic withdrawal' }));
  assert.equal(w.status, 200); assert.deepEqual(await w.json(), { state: 'withdrawn' });
  const log = (await fs.readFile(path.join(root, 'clinical-tools', 'audit.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.ok(log.every(e => IDS.includes(e.tool_id)), 'audit log names only real tools');
  assert.ok(!JSON.stringify(log).includes(password));
});

test('authentication and same-origin protections hold for JSON and plain form posts', async () => {
  const id = 'cockcroft-gault', digest = await digestOf(id);
  const variants = [[JSON_TYPE, JSON.stringify({ version_digest: digest, password, attestation: OK, reason: 'x' })], [{}, formBody({ ...ATTEST, password, version_digest: digest, reason: 'x' })]];
  for (const action of ['approve', 'withdraw']) for (const [type, body] of variants) {
    const p = '/admin/tools/' + id + '/' + action;
    const anon = await post(p, { origin: url, ...type }, body); assert.equal(anon.status, 302, 'signed-out ' + action); assert.match(anon.headers.get('location'), /login/);
    assert.equal((await post(p, { 'x-fixture-as': 'fixture-clinician', ...type }, body)).status, 403, 'no Origin ' + action);
    assert.equal((await post(p, { 'x-fixture-as': 'fixture-clinician', origin: 'https://attacker.example', ...type }, body)).status, 403, 'cross-origin ' + action);
  }
  assert.equal((await post('/admin/tools/' + id + '/approve', { ...editor(), ...JSON_TYPE }, variants[0][1])).status, 403); // an editor cannot approve
  assert.equal((await tools.status(id)).state, 'awaiting_clinical_review');
  await assert.rejects(fs.access(path.join(root, 'clinical-tools', 'approvals', id + '.json')));
});

test('log redaction: credential-like query and body values are masked, ordinary values are kept', () => {
  const { redactUrl, redact, MASK } = require('../lib/log-redaction');
  const secret = 'S3cret-' + password;
  for (const name of ['password', 'Password', 'passwd', 'pwd', 'current_password', 'token', 'access_token', 'csrf_token', 'secret', 'client_secret', 'api_key', 'apikey', 'key', 'authorization', 'auth', 'session', 'sessionid', 'signature', 'sig', 'code', 'otp', 'credential', 'pass%77ord']) {
    const out = redactUrl('/admin/tools?formulaChecked=on&' + name + '=' + encodeURIComponent(secret) + '&page=2');
    assert.ok(!out.includes(secret) && !out.includes(encodeURIComponent(secret)), name);
    assert.equal(out, '/admin/tools?formulaChecked=on&' + name + '=' + MASK + '&page=2');
  }
  assert.equal(redactUrl('/news?desk=amr&q=vancomycin+dosing&page=3'), '/news?desk=amr&q=vancomycin+dosing&page=3');
  assert.equal(redactUrl('/tools/bsa-mosteller'), '/tools/bsa-mosteller');
  assert.equal(redactUrl('/x?password=' + secret + '&password=' + secret + ';token=' + secret + '#frag'), '/x?password=' + MASK + '&password=' + MASK + '&token=' + MASK);
  assert.equal(redactUrl('/x?password'), '/x?password=' + MASK);
  assert.equal(redactUrl('/x?%zz=1&password=' + secret), '/x?%zz=1&password=' + MASK);
  const body = { reason: 'Synthetic', password: secret, attestation: { formulaChecked: true }, nested: [{ api_key: secret, name: 'kept' }], version_digest: 'abc' };
  const clean = redact(body);
  assert.ok(!JSON.stringify(clean).includes(secret));
  assert.deepEqual(clean, { reason: 'Synthetic', password: MASK, attestation: { formulaChecked: true }, nested: [{ api_key: MASK, name: 'kept' }], version_digest: 'abc' });
  assert.equal(body.password, secret, 'the original object is not modified');
});

test('access log: the request logger keeps method, path, status and harmless parameters but never a credential value', async () => {
  const { requestLogger } = require('../lib/log-redaction');
  const lines = [], app = express(), secret = 'S3cret-' + password;
  app.use(requestLogger({ stream: { write: l => lines.push(l) } }));
  app.use(express.urlencoded({ extended: false }));
  app.all('/admin/tools', (req, res) => res.send('ok'));
  const s = await new Promise(r => { const x = app.listen(0, '127.0.0.1', () => r(x)); }), base = 'http://127.0.0.1:' + s.address().port;
  try {
    await fetch(base + '/admin/tools?formulaChecked=on&citationsChecked=on&password=' + secret + '&token=' + secret);
    await fetch(base + '/admin/tools', { method: 'POST', body: formBody({ password: secret, reason: 'Synthetic' }) });
  } finally { await new Promise(r => s.close(r)); }
  const log = lines.join('');
  assert.equal(lines.length, 2);
  assert.ok(!log.includes(secret), 'no credential value in the access log');
  assert.match(lines[0], /GET \/admin\/tools\?formulaChecked=on&citationsChecked=on&password=\[REDACTED\]&token=\[REDACTED\] HTTP\/1\.1 200/);
  assert.match(lines[1], /POST \/admin\/tools HTTP\/1\.1 200/);
});

test('the real server writes its access log through the redacting logger', async () => {
  const source = await fs.readFile(path.join(cwd, 'server.js'), 'utf8');
  assert.match(source, /app\.use\(requestLogger\(\)\)/); assert.doesNotMatch(source, /morgan\(/);
  const empty = await fs.mkdtemp(path.join(os.tmpdir(), 'pharmacy-hotfix-server-')), secret = 'S3cret-' + password;
  const child = spawn(process.execPath, ['server.js'], { cwd, env: { PATH: process.env.PATH, CONTENT_DIR: empty, PORT: '0', NODE_ENV: 'production', PN_ENTRY: 'start-review', SESSION_SECRET: 'synthetic-fixture-only-not-a-real-secret', COLLECTION_PAUSED: 'true', ALLOW_COLLECTION: 'false', ALLOW_MODEL_CALLS: 'false', RUN_SCHEDULED_JOBS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'exit'); let output = '';
  child.stdout.on('data', c => { output += c; }); child.stderr.on('data', c => { output += c; });
  try {
    const base = await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Fixture startup timeout')), 10000); child.once('exit', () => { clearTimeout(timer); reject(new Error('Fixture exited before listening: ' + output)); }); const poll = setInterval(() => { const m = output.match(/http:\/\/127\.0\.0\.1:\d+/); if (m) { clearInterval(poll); clearTimeout(timer); resolve(m[0]); } }, 20); });
    assert.equal((await fetch(base + '/health?probe=1&password=' + secret)).status, 200);
    assert.equal((await fetch(base + '/admin/tools?formulaChecked=on&password=' + secret, { redirect: 'manual' })).status, 302);
    await new Promise(r => setTimeout(r, 200));
  } finally { child.kill('SIGTERM'); await exited; await fs.rm(empty, { recursive: true, force: true }); }
  assert.ok(!output.includes(secret), 'no credential value in server output');
  assert.match(output, /GET \/health\?probe=1&password=\[REDACTED\] HTTP\/1\.1 200/);
  assert.match(output, /GET \/admin\/tools\?formulaChecked=on&password=\[REDACTED\] HTTP\/1\.1 302/);
});
