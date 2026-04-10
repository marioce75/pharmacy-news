// === Toast notifications ===
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// === Article actions ===
async function approveArticle(id) {
  try {
    const res = await fetch(`/api/admin/approve/${id}`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to approve');
    const card = document.querySelector(`[data-id="${id}"]`);
    if (card) {
      card.style.transition = 'opacity 0.3s, transform 0.3s';
      card.style.opacity = '0';
      card.style.transform = 'translateX(50px)';
      setTimeout(() => card.remove(), 300);
    }
    showToast('Article approved');
    updatePendingCount(-1);
  } catch (err) {
    showToast('Failed to approve article', 'error');
  }
}

async function declineArticle(id) {
  if (!confirm('Decline this article?')) return;
  try {
    const res = await fetch(`/api/admin/decline/${id}`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to decline');
    const card = document.querySelector(`[data-id="${id}"]`);
    if (card) {
      card.style.transition = 'opacity 0.3s, transform 0.3s';
      card.style.opacity = '0';
      card.style.transform = 'translateX(-50px)';
      setTimeout(() => card.remove(), 300);
    }
    showToast('Article declined');
    updatePendingCount(-1);
  } catch (err) {
    showToast('Failed to decline article', 'error');
  }
}

async function unpublishArticle(id) {
  if (!confirm('Unpublish this article?')) return;
  try {
    const res = await fetch(`/api/admin/unpublish/${id}`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to unpublish');
    const card = document.querySelector(`[data-id="${id}"]`);
    if (card) {
      card.style.opacity = '0';
      setTimeout(() => card.remove(), 300);
    }
    showToast('Article moved back to queue');
  } catch (err) {
    showToast('Failed to unpublish article', 'error');
  }
}

function updatePendingCount(delta) {
  const badges = document.querySelectorAll('.badge');
  badges.forEach(b => {
    const val = parseInt(b.textContent) + delta;
    b.textContent = Math.max(0, val);
  });
}

// === Bulk actions ===
document.addEventListener('DOMContentLoaded', () => {
  // Checkbox selection
  const checkboxes = document.querySelectorAll('.article-check');
  const bulkApprove = document.getElementById('bulk-approve-btn');
  const bulkDecline = document.getElementById('bulk-decline-btn');

  if (checkboxes.length) {
    checkboxes.forEach(cb => {
      cb.addEventListener('change', () => {
        const checked = document.querySelectorAll('.article-check:checked');
        if (bulkApprove) bulkApprove.disabled = checked.length === 0;
        if (bulkDecline) bulkDecline.disabled = checked.length === 0;
      });
    });
  }

  if (bulkApprove) {
    bulkApprove.addEventListener('click', async () => {
      const ids = [...document.querySelectorAll('.article-check:checked')].map(cb => cb.value);
      if (!ids.length) return;
      try {
        const res = await fetch('/api/admin/bulk-approve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids })
        });
        if (!res.ok) throw new Error('Bulk approve failed');
        showToast(`${ids.length} articles approved`);
        setTimeout(() => location.reload(), 500);
      } catch (err) {
        showToast('Bulk approve failed', 'error');
      }
    });
  }

  if (bulkDecline) {
    bulkDecline.addEventListener('click', async () => {
      const ids = [...document.querySelectorAll('.article-check:checked')].map(cb => cb.value);
      if (!ids.length || !confirm(`Decline ${ids.length} articles?`)) return;
      try {
        const res = await fetch('/api/admin/bulk-decline', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids })
        });
        if (!res.ok) throw new Error('Bulk decline failed');
        showToast(`${ids.length} articles declined`);
        setTimeout(() => location.reload(), 500);
      } catch (err) {
        showToast('Bulk decline failed', 'error');
      }
    });
  }

  // === Expand/collapse ===
  document.querySelectorAll('.toggle-expand').forEach(btn => {
    btn.addEventListener('click', () => {
      const card = btn.closest('.admin-card');
      const expand = card.querySelector('.admin-card__expand');
      if (expand) {
        const hidden = expand.style.display === 'none';
        expand.style.display = hidden ? 'block' : 'none';
        btn.textContent = hidden ? 'Less ▴' : 'More ▾';
      }
    });
  });

  // === Copy caption ===
  document.querySelectorAll('.copy-caption').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const caption = decodeURIComponent(btn.dataset.caption);
      navigator.clipboard.writeText(caption).then(() => {
        showToast('Caption copied to clipboard');
      }).catch(() => {
        showToast('Failed to copy', 'error');
      });
    });
  });

  // === Approve entire slate ===
  const approveSlateBtn = document.getElementById('approve-slate-btn');
  if (approveSlateBtn) {
    approveSlateBtn.addEventListener('click', async () => {
      if (!confirm('Approve all articles in the recommended slate?')) return;
      approveSlateBtn.disabled = true;
      approveSlateBtn.textContent = 'Approving...';
      try {
        const res = await fetch('/api/admin/approve-slate', { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');
        showToast(`${data.approved} articles approved from slate`);
        setTimeout(() => location.reload(), 1000);
      } catch (err) {
        showToast('Failed to approve slate', 'error');
        approveSlateBtn.disabled = false;
        approveSlateBtn.textContent = 'Approve Entire Slate';
      }
    });
  }

  // === Run PharmEditor ===
  const pharmEditorButtons = document.querySelectorAll('#run-pharmeditor-btn, #run-pharmeditor-empty');
  pharmEditorButtons.forEach(btn => {
    if (!btn) return;
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Analyzing...';
      try {
        const res = await fetch('/api/admin/run-pharmeditor', { method: 'POST' });
        const data = await res.json();
        showToast(data.message || 'PharmEditor started');
      } catch (err) {
        showToast('Failed to start PharmEditor', 'error');
      }
      setTimeout(() => {
        btn.disabled = false;
        btn.textContent = btn.id === 'run-pharmeditor-empty' ? 'Run PharmEditor Now' : 'Re-run PharmEditor';
      }, 30000);
    });
  });

  // === Run scraper ===
  const scrapeButtons = document.querySelectorAll('#run-scrape-btn, #run-scrape-empty, #run-scrape-settings');
  scrapeButtons.forEach(btn => {
    if (!btn) return;
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Scraping...';
      try {
        const res = await fetch('/api/admin/scrape', { method: 'POST' });
        const data = await res.json();
        showToast(data.message || 'Scraping started');
        const status = document.getElementById('scrape-status');
        if (status) status.textContent = 'Scraping is running in the background. Refresh to see new articles.';
      } catch (err) {
        showToast('Failed to start scraper', 'error');
      }
      setTimeout(() => {
        btn.disabled = false;
        btn.textContent = btn.id === 'run-scrape-empty' ? 'Run Scraper Now' : 'Run Scraper';
      }, 5000);
    });
  });

  // === Edit form ===
  const editForm = document.getElementById('edit-form');
  if (editForm) {
    editForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = editForm.dataset.id;
      const formData = new FormData(editForm);
      const data = {};

      for (const [key, value] of formData.entries()) {
        if (['tags', 'drug_names', 'companies'].includes(key)) {
          data[key] = value.split(',').map(s => s.trim()).filter(Boolean);
        } else {
          data[key] = value;
        }
      }

      try {
        const res = await fetch(`/api/admin/articles/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        if (!res.ok) throw new Error('Save failed');
        showToast('Article saved');
      } catch (err) {
        showToast('Failed to save article', 'error');
      }
    });
  }

  // === Search published ===
  const searchInput = document.getElementById('search-published');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      const query = searchInput.value.toLowerCase();
      document.querySelectorAll('.admin-card').forEach(card => {
        const title = card.querySelector('.admin-card__title')?.textContent.toLowerCase() || '';
        const summary = card.querySelector('.admin-card__summary')?.textContent.toLowerCase() || '';
        card.style.display = (title.includes(query) || summary.includes(query)) ? '' : 'none';
      });
    });
  }
});
