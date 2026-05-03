module.exports = {
  'fda-approvals': [
    { name: 'FDA Press Releases', type: 'rss', url: 'https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/press-releases/rss.xml', keywords: ['approv', 'clear', 'authoriz'] },
    { name: 'FDA Drug News', type: 'rss', url: 'https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/drugs/rss.xml' }
  ],
  'industry': [
    { name: 'FiercePharma', type: 'rss', url: 'https://www.fiercepharma.com/rss/xml' },
    { name: 'STAT News', type: 'rss', url: 'https://www.statnews.com/feed/' },
    { name: 'Endpoints News', type: 'rss', url: 'https://endpts.com/feed/' }
  ],
  'disease-research': [
    { name: 'Nature Medicine', type: 'rss', url: 'https://www.nature.com/nm.rss' },
    { name: 'Science', type: 'rss', url: 'https://www.science.org/action/showFeed?type=etoc&feed=rss&jc=science' },
    { name: 'Nature Aging', type: 'rss', url: 'https://www.nature.com/nature-aging.rss' },
    { name: 'Lifespan.io', type: 'rss', url: 'https://www.lifespan.io/feed/' },
    { name: 'Longevity.Technology', type: 'rss', url: 'https://longevity.technology/news/feed/' },
    { name: 'Endocrine Society', type: 'rss', url: 'https://www.endocrine.org/news-and-advocacy/news-room/rss' }
  ],
  'pharmacy-practice': [
    { name: 'Pharmacy Times', type: 'rss', url: 'https://www.pharmacytimes.com/rss' },
    { name: 'ASHP News', type: 'web', url: 'https://www.ashp.org/news', selector: '.news-item' }
  ],
  'global-health': [
    { name: 'WHO News', type: 'rss', url: 'https://www.who.int/rss-feeds/news-english.xml' },
    { name: 'Lancet Global Health', type: 'rss', url: 'https://www.thelancet.com/rssfeed/langlo_current.xml' }
  ]
};
