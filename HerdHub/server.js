// Express server — image upload API + serves the built React frontend
import express from 'express';
import { writeFile, mkdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import session from 'express-session';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IMG_DIR = path.join(__dirname, 'public', 'images');
const DIST_DIR = path.join(__dirname, 'dist');
const BREEDS_PERSISTENT = path.join(IMG_DIR, '_breeds.json');
const BREEDS_BUNDLED    = path.join(__dirname, 'public', 'breeds.json');
const PORT = process.env.PORT || 3001;

// Auth is only active when Google credentials are provided (skipped in local dev)
const AUTH_ENABLED = !!process.env.GOOGLE_CLIENT_ID;

const ALLOWED_EMAILS = new Set([
  'hamata25@gmail.com',
  'pauldenhertog256@gmail.com',
  'omarghanidenhertog@gmail.com',
  'mariamdenhertog256@gmail.com',
]);

const app = express();
app.use(express.json({ limit: '25mb' }));

// ── Session ───────────────────────────────────────────────────────────────────
app.use(session({
  secret: process.env.SESSION_SECRET || 'herdhub-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
}));

// ── Google OAuth (only when credentials are set) ───────────────────────────────
if (AUTH_ENABLED) {
  passport.use(new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback',
    },
    (_accessToken, _refreshToken, profile, done) => {
      const email = profile.emails?.[0]?.value?.toLowerCase();
      if (!email || !ALLOWED_EMAILS.has(email)) return done(null, false);
      done(null, {
        id: profile.id,
        email,
        name: profile.displayName,
        photo: profile.photos?.[0]?.value,
      });
    },
  ));
  passport.serializeUser((user, done) => done(null, user));
  passport.deserializeUser((user, done) => done(null, user));

  app.use(passport.initialize());
  app.use(passport.session());

  app.get('/auth/google',
    passport.authenticate('google', { scope: ['email', 'profile'] }),
  );
  app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/?error=unauthorized' }),
    (_req, res) => res.redirect('/'),
  );
  app.get('/auth/logout', (req, res) => {
    req.logout(() => res.redirect('/'));
  });
}

// ── Auth middleware ────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (!AUTH_ENABLED || req.isAuthenticated()) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

// ── API ───────────────────────────────────────────────────────────────────────

app.get('/api/me', (req, res) => {
  if (!AUTH_ENABLED) return res.json({ email: 'dev@local', name: 'Developer' });
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthenticated' });
  res.json(req.user);
});

// Return persisted breeds if available, else fall back to bundled
app.get('/api/breeds', requireAuth, async (req, res) => {
  try {
    const src = existsSync(BREEDS_PERSISTENT) ? BREEDS_PERSISTENT : BREEDS_BUNDLED;
    const data = await readFile(src, 'utf8');
    res.type('application/json').send(data);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Save the full breeds array to the persistent volume
app.post('/api/save-breeds', requireAuth, async (req, res) => {
  try {
    const breeds = req.body;
    if (!Array.isArray(breeds)) return res.status(400).json({ error: 'Expected array' });
    await mkdir(IMG_DIR, { recursive: true });
    await writeFile(BREEDS_PERSISTENT, JSON.stringify(breeds, null, 2));
    res.json({ ok: true, count: breeds.length });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/upload-image', requireAuth, async (req, res) => {
  try {
    const { name, dataUrl } = req.body;
    if (!name || !dataUrl) return res.status(400).json({ error: 'Missing name or dataUrl' });

    const slug = name.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_');
    const ext = dataUrl.match(/^data:image\/(\w+);/)?.[1]?.replace('jpeg', 'jpg') ?? 'jpg';
    const filename = `${slug}.${ext}`;

    const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
    await mkdir(IMG_DIR, { recursive: true });
    await writeFile(path.join(IMG_DIR, filename), Buffer.from(base64, 'base64'));

    res.json({ path: `/images/${filename}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

// ── Static frontend (production) ──────────────────────────────────────────────

app.use(express.static(DIST_DIR));
app.use('/images', express.static(path.join(__dirname, 'public', 'images')));

// SPA fallback — all non-API routes serve index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(DIST_DIR, 'index.html'));
});

app.listen(PORT, () => console.log(`HerdHub → http://localhost:${PORT}`));
