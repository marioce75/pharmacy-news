require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const morgan = require('morgan');
const store = require('./lib/store');
const scheduler = require('./lib/scheduler');

// In production the server must be started through scripts/start-review.js (npm start), which
// verifies the persistent disk, opens the versioned store and applies the collection policy.
// Starting server.js directly would use a different content directory and raw environment flags.
if(process.env.NODE_ENV==='production'&&process.env.PN_ENTRY!=='start-review')throw new Error('Production must be started with `npm start` (scripts/start-review.js); refusing direct server.js start');
if(process.env.NODE_ENV==='production'&&String(process.env.SESSION_SECRET||'').length<32)throw new Error('Production SESSION_SECRET of at least 32 characters is required');
const SESSIONS_DIR = path.join(process.env.CONTENT_DIR || path.join(__dirname,'content'), 'sessions');
// Session files identify signed-in reviewers; a newly created directory is owner-only.
fs.mkdirSync(SESSIONS_DIR, { recursive: true, mode: 0o700 });

const app = express();
const PORT = process.env.PORT || 0;

// Render terminates TLS at its proxy and forwards HTTP — trust the
// X-Forwarded-Proto header so secure cookies work in production.
app.set('trust proxy', 1);

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(require('./middleware/security').headers);
app.use(morgan('short'));
app.use(express.json({limit:'256kb'}));
app.use(express.urlencoded({ extended: false, limit:'256kb' }));
app.use(cookieParser());
app.use(session({
  store: new FileStore({
    path: SESSIONS_DIR,
    ttl: 8 * 60 * 60, // seconds
    retries: 0,
    logFn: () => {} // silence routine info logs
  }),
  secret: process.env.SESSION_SECRET || require('crypto').randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 8 * 60 * 60 * 1000 // 8 hours
  }
}));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Make categories available to all templates
const { CATEGORIES } = require('./config/categories');
app.use((req, res, next) => {
  res.locals.categories = CATEGORIES;
  next();
});

app.use('/atlas', express.static(path.join(__dirname, 'public', 'atlas')));

// Routes
const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');
const apiRoutes = require('./routes/api');
const bugsDrugsRoutes = require('./routes/bugs-drugs');

// Reader pages, clinical tools, newsletter, sponsorship and affordability directory.
const siteRoutes = require('./routes/site'), sponsorRoutes = require('./routes/sponsors'), newsletterRoutes = require('./routes/newsletter');
app.use('/', siteRoutes.publicRouter);
app.use('/', sponsorRoutes.publicRouter);
app.use('/', newsletterRoutes.publicRouter);
app.use('/', require('./routes/affordability'));
app.use('/admin', siteRoutes.adminRouter);
app.use('/admin', sponsorRoutes.adminRouter);
app.use('/admin', newsletterRoutes.adminRouter);
app.use('/', publicRoutes);
app.use('/admin', require('./routes/monitoring'));
app.use('/admin', adminRoutes);
app.use('/api', apiRoutes);
// Clinical reference excluded from the local redevelopment candidate.
app.use('/bugs-and-drugs', (req,res)=>res.status(503).render('layout',{title:'Reference not available — PharmacyNews.ai',activeCategory:null,body:'<h1>This reference is not available</h1><p>The infectious-disease reference is switched off until every entry has citations and a verified clinical approval. See <a href="/tools">clinical tools</a> for status.</p>'}));

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// 404
app.use((req, res) => {
  res.status(404).render('layout', {
    title: 'Not found — PharmacyNews.ai',
    activeCategory: null,
    body: '<h1>Page not found</h1><p>The page you are looking for does not exist. <a href="/">Back to the monitor</a> or browse the <a href="/news">news index</a>.</p>'
  });
});

// Error handler
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  // Client errors (bad JSON, oversized bodies) are not server faults.
  if (err.status >= 400 && err.status < 500) return res.status(err.status).type('text').send(err.status === 413 ? 'Request too large' : 'Bad request');
  console.error(err.stack);
  res.status(500).render('layout', {
    title: 'Error — PharmacyNews.ai',
    activeCategory: null,
    body: '<h1>Something went wrong</h1><p>Please try again later.</p>'
  });
});

// Ensure content directories exist
store.ensureDirectories();

// Schedule scraping — daily at 10:00 UTC (4 AM CST / 5 AM CDT)
scheduler.startScheduledJobs();

// Loopback by default; a public binding (e.g. HOST=0.0.0.0 on Render) must be set deliberately.
const HOST = process.env.HOST || '127.0.0.1';
const listener = app.listen(PORT, HOST, () => {
  console.log(`Pharmacy News running at http://${HOST}:${listener.address().port}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('[WARN] ANTHROPIC_API_KEY not set — PharmEditor AI analysis will be disabled');
  }
  if (!process.env.ADMIN_PASSWORD_HASH || !process.env.ADMIN_USERNAME) {
    console.warn('[WARN] ADMIN_USERNAME and/or ADMIN_PASSWORD_HASH not set — admin login will fail');
  }
});
