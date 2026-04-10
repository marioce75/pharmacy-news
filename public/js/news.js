// Client-side category tab switching via fetch (no full page reload)
document.addEventListener('DOMContentLoaded', () => {
  const navLinks = document.querySelectorAll('.nav-link[data-category]');
  const grid = document.getElementById('news-grid');
  if (!grid || !navLinks.length) return;

  navLinks.forEach(link => {
    link.addEventListener('click', async (e) => {
      e.preventDefault();
      const category = link.dataset.category;

      // Update active state
      navLinks.forEach(l => l.classList.remove('active'));
      link.classList.add('active');

      // Update URL without reload
      const url = category === 'all' ? '/' : `/?category=${category}`;
      history.pushState(null, '', url);

      // Fetch filtered articles
      const apiUrl = category === 'all' ? '/api/articles' : `/api/articles?category=${category}`;
      try {
        const res = await fetch(apiUrl);
        const data = await res.json();
        renderGrid(data.articles, data.categories);
      } catch (err) {
        console.error('Failed to fetch articles:', err);
      }
    });
  });

  // Handle back/forward browser navigation
  window.addEventListener('popstate', async () => {
    const params = new URLSearchParams(window.location.search);
    const category = params.get('category') || 'all';
    navLinks.forEach(l => l.classList.toggle('active', l.dataset.category === category));
    const apiUrl = category === 'all' ? '/api/articles' : `/api/articles?category=${category}`;
    try {
      const res = await fetch(apiUrl);
      const data = await res.json();
      renderGrid(data.articles, data.categories);
    } catch (err) {
      console.error('Failed to fetch articles:', err);
    }
  });
});

function renderGrid(articles, categories) {
  const grid = document.getElementById('news-grid');
  if (!articles.length) {
    grid.innerHTML = '<p style="color:var(--text-muted);grid-column:1/-1;text-align:center;padding:3rem 0">No articles in this category yet.</p>';
    return;
  }
  grid.innerHTML = articles.map(a => {
    const cat = categories[a.category] || { label: a.category, color: '#888' };
    const date = new Date(a.date_published + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const img = a.image
      ? `<img class="news-card__image" src="${a.image}" alt="" loading="lazy">`
      : '<div class="news-card__image" style="background:var(--bg-card-hover)"></div>';
    return `<a href="/article/${a.slug}" class="news-card">
      ${img}
      <div class="news-card__body">
        <div class="news-card__meta">
          <span class="news-card__tag" style="--tag-color:${cat.color}">${cat.label}</span>
          <span class="news-card__dot"></span>
          <span class="news-card__source">${a.source}</span>
          <span class="news-card__dot"></span>
          <time>${date}</time>
        </div>
        <h2 class="news-card__title">${a.title}</h2>
        <p class="news-card__summary">${a.summary}</p>
      </div>
    </a>`;
  }).join('');
}
