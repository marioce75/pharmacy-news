module.exports = {
  'fda-approvals': [
    { name: 'FDA Press Releases', type: 'rss', url: 'https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/press-releases/rss.xml', keywords: ['approv', 'clear', 'authoriz'] },
    { name: 'FDA Drug News', type: 'rss', url: 'https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/drugs/rss.xml' }
  ],
  'ema-approvals': [
    { name: 'EMA News', type: 'rss', url: 'https://www.ema.europa.eu/en/news-events/rss', keywords: ['authoris', 'approv', 'opinion', 'marketing'] }
  ],
  'apac-approvals': [
    { name: 'TGA Media Releases', type: 'web', url: 'https://www.tga.gov.au/news/media-releases', selector: '.views-row' },
    { name: 'PMDA News', type: 'web', url: 'https://www.pmda.go.jp/english/about-pmda/news-and-information/', selector: '.news-list li' }
  ],
  'trials-ongoing': [
    { name: 'NIH News Releases', type: 'rss', url: 'https://www.nih.gov/news-events/news-releases/feed', keywords: ['clinical trial', 'study', 'enrollment', 'recruit'] }
  ],
  'trials-results': [
    { name: 'NEJM', type: 'rss', url: 'https://www.nejm.org/action/showFeed?jc=nejm&type=etoc&feed=rss' },
    { name: 'The Lancet', type: 'rss', url: 'https://www.thelancet.com/rssfeed/lancet_current.xml' },
    { name: 'JAMA', type: 'rss', url: 'https://jamanetwork.com/rss/site_3/67.xml' }
  ],
  'drug-safety': [
    { name: 'FDA MedWatch', type: 'rss', url: 'https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/medwatch/rss.xml' },
    { name: 'FDA Recalls', type: 'rss', url: 'https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/recalls/rss.xml' }
  ],
  'industry': [
    { name: 'FiercePharma', type: 'rss', url: 'https://www.fiercepharma.com/rss/xml' },
    { name: 'STAT News', type: 'rss', url: 'https://www.statnews.com/feed/' },
    { name: 'Endpoints News', type: 'rss', url: 'https://endpts.com/feed/' }
  ],
  'disease-research': [
    { name: 'Nature Medicine', type: 'rss', url: 'https://www.nature.com/nm.rss' },
    { name: 'Science', type: 'rss', url: 'https://www.science.org/action/showFeed?type=etoc&feed=rss&jc=science' }
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
