'use strict';
// Admin clinical-tool review: posts approvals and withdrawals as same-origin JSON.
async function send(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, message: res.ok ? 'Recorded: ' + (data.state || 'done') + '. Reload to see the new status.' : (data.error || 'Request failed') };
}
document.querySelectorAll('[data-tool-approve]').forEach(form => form.addEventListener('submit', async e => {
  e.preventDefault();
  const id = form.dataset.toolApprove, f = new FormData(form);
  const r = await send('/admin/tools/' + id + '/approve', { version_digest: form.dataset.digest, password: f.get('password'), attestation: { formulaChecked: f.get('formulaChecked') === 'on', citationsChecked: f.get('citationsChecked') === 'on', testCasesChecked: f.get('testCasesChecked') === 'on' } });
  form.querySelector('[name=password]').value = '';
  document.querySelector('[data-tool-status="' + id + '"]').textContent = r.message;
}));
document.querySelectorAll('[data-tool-withdraw]').forEach(form => form.addEventListener('submit', async e => {
  e.preventDefault();
  const id = form.dataset.toolWithdraw;
  const r = await send('/admin/tools/' + id + '/withdraw', { reason: new FormData(form).get('reason') });
  document.querySelector('[data-tool-status="' + id + '"]').textContent = r.message;
}));
