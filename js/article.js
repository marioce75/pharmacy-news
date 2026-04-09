// Article detail page rendering
document.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  const slug = params.get("slug");
  const article = slug ? getArticle(slug) : null;

  if (!article) {
    document.getElementById("article-content").innerHTML = `
      <div style="text-align: center; padding: 4rem 0;">
        <h1 style="font-family: 'DM Serif Display', serif; margin-bottom: 1rem;">Article Not Found</h1>
        <p style="color: var(--text-muted); margin-bottom: 2rem;">The article you're looking for doesn't exist or has been moved.</p>
        <a href="/" class="back-link">← Back to homepage</a>
      </div>`;
    return;
  }

  const cat = getCategoryInfo(article.category);

  document.title = `${article.title} — Pharmacy News`;

  // Set meta description
  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc) metaDesc.content = article.summary;

  document.getElementById("article-content").innerHTML = `
    <a href="/" class="back-link">← Back to all articles</a>
    <article class="article">
      <header class="article__header">
        <div class="article__meta">
          <span class="news-card__tag" style="--tag-color: ${cat.color}">${cat.label}</span>
          <span class="news-card__dot"></span>
          <span class="article__source">${article.source}</span>
          <span class="news-card__dot"></span>
          <time>${formatDate(article.date)}</time>
        </div>
        <h1 class="article__title">${article.title}</h1>
        <p class="article__summary">${article.summary}</p>
      </header>
      <img class="article__hero" src="${article.image.replace('w=600&h=340', 'w=1200&h=500')}" alt="" loading="lazy">
      <div class="article__body">${article.body}</div>
    </article>
    <div class="article__footer">
      <a href="/" class="back-link">← Back to all articles</a>
    </div>`;
});
