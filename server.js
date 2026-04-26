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

const SESSIONS_DIR = path.join(__dirname, 'content', 'sessions');
fs.mkdirSync(SESSIONS_DIR, { recursive: true });

const app = express();
const PORT = process.env.PORT || 3000;

// Render terminates TLS at its proxy and forwards HTTP — trust the
// X-Forwarded-Proto header so secure cookies work in production.
app.set('trust proxy', 1);

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(morgan('short'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(session({
  store: new FileStore({
    path: SESSIONS_DIR,
    ttl: 8 * 60 * 60, // seconds
    retries: 0,
    logFn: () => {} // silence routine info logs
  }),
  secret: process.env.SESSION_SECRET || 'pharmacy-news-fallback-secret',
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

// Routes
const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');
const apiRoutes = require('./routes/api');

app.use('/', publicRoutes);
app.use('/admin', adminRoutes);
app.use('/api', apiRoutes);

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// 404
app.use((req, res) => {
  res.status(404).render('layout', {
    title: 'Not Found — Pharmacy News',
    activeCategory: null,
    body: '<div style="text-align:center;padding:4rem 0"><h1 style="font-family:DM Serif Display,serif;margin-bottom:1rem">404 — Page Not Found</h1><p style="color:var(--text-muted)">The page you\'re looking for doesn\'t exist.</p><a href="/" style="color:var(--signal-green);margin-top:1rem;display:inline-block">← Back to homepage</a></div>'
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('layout', {
    title: 'Error — Pharmacy News',
    activeCategory: null,
    body: '<div style="text-align:center;padding:4rem 0"><h1 style="font-family:DM Serif Display,serif;margin-bottom:1rem">Something went wrong</h1><p style="color:var(--text-muted)">Please try again later.</p></div>'
  });
});

// Ensure content directories exist
store.ensureDirectories();

// Schedule scraping — daily at 10:00 UTC (4 AM CST / 5 AM CDT)
scheduler.startScheduledJobs();

app.listen(PORT, () => {
  console.log(`Pharmacy News running at http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('[WARN] ANTHROPIC_API_KEY not set — PharmEditor AI analysis will be disabled');
  }
  if (!process.env.ADMIN_PASSWORD_HASH || !process.env.ADMIN_USERNAME) {
    console.warn('[WARN] ADMIN_USERNAME and/or ADMIN_PASSWORD_HASH not set — admin login will fail');
  }
});
