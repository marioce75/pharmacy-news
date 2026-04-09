// Homepage: render cards with category filtering
let activeCategory = "all";

function renderCards() {
  const grid = document.getElementById("news-grid");
  const filtered = activeCategory === "all"
    ? articles
    : articles.filter(a => a.category === activeCategory);

  if (filtered.length === 0) {
    grid.innerHTML = `<p style="color: var(--text-muted); grid-column: 1 / -1; text-align: center; padding: 3rem 0;">No articles in this category yet.</p>`;
    return;
  }

  grid.innerHTML = filtered.map(article => {
    const cat = getCategoryInfo(article.category);
    return `
    <a href="article.html?slug=${article.slug}" class="news-card">
      <img class="news-card__image" src="${article.image}" alt="" loading="lazy">
      <div class="news-card__body">
        <div class="news-card__meta">
          <span class="news-card__tag" style="--tag-color: ${cat.color}">${cat.label}</span>
          <span class="news-card__dot"></span>
          <span class="news-card__source">${article.source}</span>
          <span class="news-card__dot"></span>
          <time>${formatDate(article.date)}</time>
        </div>
        <h2 class="news-card__title">${article.title}</h2>
        <p class="news-card__summary">${article.summary}</p>
      </div>
    </a>`;
  }).join("");
}

function setActiveCategory(slug) {
  activeCategory = slug;
  document.querySelectorAll(".nav-link").forEach(link => {
    link.classList.toggle("active", link.dataset.category === slug);
  });
  renderCards();
}

document.addEventListener("DOMContentLoaded", () => {
  // Bind nav links
  document.querySelectorAll(".nav-link[data-category]").forEach(link => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      setActiveCategory(link.dataset.category);
    });
  });

  // Check URL hash for category
  const hash = window.location.hash.slice(1);
  if (hash && (hash === "all" || CATEGORIES[hash])) {
    activeCategory = hash;
  }

  // Set initial active state
  document.querySelectorAll(".nav-link").forEach(link => {
    link.classList.toggle("active", link.dataset.category === activeCategory);
  });

  renderCards();
});
