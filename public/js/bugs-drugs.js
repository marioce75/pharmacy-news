(function () {
  'use strict';

  // === Gate modal ===
  const gateForm = document.getElementById('bd-gate-form');
  if (gateForm) {
    const cb = document.getElementById('bd-gate-checkbox');
    const submit = document.getElementById('bd-gate-submit');
    cb.addEventListener('change', () => { submit.disabled = !cb.checked; });
    gateForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!cb.checked) return;
      try {
        const res = await fetch('/bugs-and-drugs/acknowledge', {
          method: 'POST',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          body: '{}'
        });
        if (res.ok) document.getElementById('bd-gate').remove();
      } catch {
        // fall back to non-AJAX submit
        gateForm.submit();
      }
    });
  }

  // === Search (client-side fuzzy) ===
  const searchInput = document.getElementById('bd-search-input');
  const searchResults = document.getElementById('bd-search-results');
  let searchIndex = null;
  let activeIdx = -1;

  function fuzzyScore(needle, hay) {
    needle = needle.toLowerCase().trim();
    hay = hay.toLowerCase();
    if (!needle) return 0;
    if (hay === needle) return 1000;
    if (hay.startsWith(needle)) return 500 - hay.length;
    if (hay.includes(needle)) return 250 - hay.length;
    // subsequence match
    let i = 0, j = 0, gaps = 0;
    while (i < needle.length && j < hay.length) {
      if (needle[i] === hay[j]) i++; else gaps++;
      j++;
    }
    if (i === needle.length) return 100 - gaps;
    return -1;
  }

  function search(q) {
    if (!searchIndex || !q) return [];
    const term = q.toLowerCase().trim();
    if (term.length < 2) return [];
    const hits = [];
    for (const item of searchIndex) {
      let best = -1;
      for (const k of item.keywords) {
        const s = fuzzyScore(term, k);
        if (s > best) best = s;
      }
      if (best > 0) hits.push({ item, score: best });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, 12).map(h => h.item);
  }

  function renderResults(items) {
    if (!searchResults) return;
    if (items.length === 0) {
      searchResults.classList.remove('is-open');
      searchResults.innerHTML = '';
      return;
    }
    searchResults.classList.add('is-open');
    searchResults.innerHTML = items.map((it, i) => {
      const href = it.kind === 'drug'
        ? `/bugs-and-drugs/drug/${it.slug}`
        : it.kind === 'syndrome'
          ? `/bugs-and-drugs/syndrome/${it.slug}`
          : `/bugs-and-drugs/organism/${it.slug}`;
      return `<li role="option" data-href="${href}" data-idx="${i}" class="${i === activeIdx ? 'is-active' : ''}">
        <span class="bd-sr__kind">${it.kind}</span>${escapeHtml(it.label)}
        <span class="bd-sr__sub">${escapeHtml(it.sub)}</span>
      </li>`;
    }).join('');
    [...searchResults.querySelectorAll('li')].forEach(li => {
      li.addEventListener('click', () => { window.location = li.dataset.href; });
    });
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  if (searchInput) {
    fetch('/bugs-and-drugs/api/search-index')
      .then(r => r.json())
      .then(data => { searchIndex = data.items; })
      .catch(() => { searchIndex = []; });

    let lastResults = [];
    searchInput.addEventListener('input', () => {
      activeIdx = -1;
      lastResults = search(searchInput.value);
      renderResults(lastResults);
    });
    searchInput.addEventListener('keydown', (e) => {
      if (!lastResults.length) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeIdx = Math.min(lastResults.length - 1, activeIdx + 1);
        renderResults(lastResults);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeIdx = Math.max(0, activeIdx - 1);
        renderResults(lastResults);
      } else if (e.key === 'Enter' && activeIdx >= 0) {
        e.preventDefault();
        const it = lastResults[activeIdx];
        const href = it.kind === 'drug'
          ? `/bugs-and-drugs/drug/${it.slug}`
          : it.kind === 'syndrome'
            ? `/bugs-and-drugs/syndrome/${it.slug}`
            : `/bugs-and-drugs/organism/${it.slug}`;
        window.location = href;
      } else if (e.key === 'Escape') {
        searchResults.classList.remove('is-open');
      }
    });
    document.addEventListener('click', (e) => {
      if (!searchResults.contains(e.target) && e.target !== searchInput) {
        searchResults.classList.remove('is-open');
      }
    });
  }

  // === Dose calculator ===
  const calcForm = document.getElementById('bd-calc-form');
  const calcResult = document.getElementById('bd-calc-result');
  if (calcForm && calcResult) {
    calcForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(calcForm);
      const body = Object.fromEntries(fd.entries());
      calcResult.hidden = false;
      calcResult.innerHTML = '<p class="bd-empty">Calculating…</p>';
      try {
        const res = await fetch('/bugs-and-drugs/api/calculate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const json = await res.json();
        if (!res.ok) {
          const msgs = (json.details || [json.error || 'Error']).join('<br>');
          calcResult.innerHTML = `<div class="bd-result__error">${msgs}</div>`;
          return;
        }
        renderResult(json.result);
      } catch {
        calcResult.innerHTML = '<div class="bd-result__error">Calculation failed. Try again.</div>';
      }
    });
  }

  function renderResult(r) {
    const cautions = (r.cautions || []).map(c => `<div class="bd-result__caution">⚠ ${escapeHtml(c)}</div>`).join('');
    const recs = (r.recommendation || []).map(rec => `<div class="bd-result__rec">${escapeHtml(rec)}</div>`).join('');
    const rule = r.renal_rule ? `<div class="bd-result__rule">Renal rule applied: ${escapeHtml(r.renal_rule)}</div>` : '';
    const crcl = r.crcl != null ? `<div class="bd-result__crcl">CrCl: ${r.crcl} mL/min — ${escapeHtml(r.crcl_basis || '')}</div>` : '';
    const weight = r.weight_used ? `<div class="bd-result__crcl">Dosing weight: ${r.weight_used} kg — ${escapeHtml(r.weight_basis || '')}</div>` : '';
    const notes = (r.notes || []).map(n => `<li>${escapeHtml(n)}</li>`).join('');
    const labelLink = r.sources && r.sources.label
      ? `<a href="${r.sources.label}" target="_blank" rel="noopener noreferrer">Verify against the FDA label →</a>`
      : '';

    calcResult.innerHTML = `
      <h3>${escapeHtml(r.drug)} ${r.is_pediatric ? '— Pediatric' : '— Adult'}</h3>
      ${cautions}
      ${recs}
      ${crcl}
      ${weight}
      ${rule}
      ${notes ? `<ul class="bd-result__notes">${notes}</ul>` : ''}
      <div class="bd-result__verify">⚠ Verify dose against the FDA label before administering. This calculator is a starting point only. ${labelLink}</div>
    `;
  }

  // === Combobox (per-section searchable dropdown) ===
  const comboDataEl = document.getElementById('bd-combo-data');
  let comboData = null;
  if (comboDataEl) {
    try { comboData = JSON.parse(comboDataEl.textContent); } catch { comboData = null; }
  }

  function comboHref(kind, slug) {
    return kind === 'drug'
      ? `/bugs-and-drugs/drug/${slug}`
      : kind === 'syndrome'
        ? `/bugs-and-drugs/syndrome/${slug}`
        : `/bugs-and-drugs/organism/${slug}`;
  }

  function comboFilter(items, q) {
    const term = (q || '').toLowerCase().trim();
    if (!term) return items;
    return items
      .map(it => {
        const hay = (it.label + ' ' + (it.sub || '')).toLowerCase();
        if (hay === term) return { it, score: 1000 };
        if (hay.startsWith(term)) return { it, score: 500 - hay.length };
        if (hay.includes(term)) return { it, score: 250 - hay.length };
        return null;
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)
      .map(x => x.it);
  }

  function comboRender(combo, items) {
    const ul = combo.querySelector('.bd-combo__results');
    const kind = combo.dataset.kind;
    if (!items.length) {
      ul.innerHTML = '<li class="bd-combo__empty" role="status">No matches</li>';
      return;
    }
    const hasGroups = items.some(it => it.group);
    let html = '';
    let lastGroup = null;
    items.forEach((it, i) => {
      if (hasGroups && it.group && it.group !== lastGroup) {
        html += `<li class="bd-combo__group" role="presentation">${escapeHtml(it.group)}</li>`;
        lastGroup = it.group;
      }
      const subHtml = it.sub ? `<span class="bd-combo__sub">${escapeHtml(it.sub)}</span>` : '';
      html += `<li role="option" data-href="${comboHref(kind, it.slug)}" data-idx="${i}">
        <span class="bd-combo__label">${escapeHtml(it.label)}</span>
        ${subHtml}
      </li>`;
    });
    ul.innerHTML = html;
    ul.querySelectorAll('li[role="option"]').forEach(li => {
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        window.location = li.dataset.href;
      });
    });
  }

  function initCombo(combo) {
    const kind = combo.dataset.kind;
    const items = (comboData && comboData[kind]) || [];
    const input = combo.querySelector('.bd-combo__input');
    const ul = combo.querySelector('.bd-combo__results');
    let filtered = items.slice();
    let active = -1;

    function open() {
      combo.classList.add('is-open');
      filtered = comboFilter(items, input.value);
      active = -1;
      comboRender(combo, filtered);
    }
    function close() {
      combo.classList.remove('is-open');
      active = -1;
    }
    function highlight(idx) {
      const opts = ul.querySelectorAll('li[role="option"]');
      opts.forEach(li => li.classList.remove('is-active'));
      if (idx >= 0 && opts[idx]) {
        opts[idx].classList.add('is-active');
        opts[idx].scrollIntoView({ block: 'nearest' });
      }
    }

    input.addEventListener('focus', open);
    input.addEventListener('input', () => {
      filtered = comboFilter(items, input.value);
      active = -1;
      combo.classList.add('is-open');
      comboRender(combo, filtered);
    });
    input.addEventListener('keydown', (e) => {
      if (!combo.classList.contains('is-open') && (e.key === 'ArrowDown' || e.key === 'Enter')) {
        open();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        active = Math.min(filtered.length - 1, active + 1);
        highlight(active);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        active = Math.max(0, active - 1);
        highlight(active);
      } else if (e.key === 'Enter') {
        if (active >= 0 && filtered[active]) {
          e.preventDefault();
          window.location = comboHref(kind, filtered[active].slug);
        }
      } else if (e.key === 'Escape') {
        close();
        input.blur();
      }
    });
    document.addEventListener('click', (e) => {
      if (!combo.contains(e.target)) close();
    });
  }

  document.querySelectorAll('.bd-combo').forEach(initCombo);

  // === PubMed Recent Evidence widget ===
  const pubmedDiv = document.getElementById('bd-pubmed');
  if (pubmedDiv && pubmedDiv.dataset.query) {
    fetch(`/bugs-and-drugs/api/pubmed?q=${encodeURIComponent(pubmedDiv.dataset.query)}`)
      .then(r => r.json())
      .then(data => {
        if (!data.articles || data.articles.length === 0) {
          pubmedDiv.innerHTML = '<p class="bd-empty">No recent PubMed results found.</p>';
          return;
        }
        pubmedDiv.innerHTML = '<ul class="bd-pubmed-list">' + data.articles.map(a => `
          <li>
            <a href="${escapeHtml(a.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(a.title)}</a>
            <span class="bd-pm__meta">${escapeHtml(a.authors)} · ${escapeHtml(a.journal)} · ${escapeHtml(a.pubdate)}</span>
          </li>
        `).join('') + '</ul>';
      })
      .catch(() => {
        pubmedDiv.innerHTML = '<p class="bd-empty">PubMed unavailable.</p>';
      });
  }
})();
