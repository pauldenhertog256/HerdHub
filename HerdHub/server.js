// Express server — image upload API + serves the built React frontend
import express from 'express';
import { writeFile, mkdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import session from 'express-session';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const IMG_DIR     = path.join(__dirname, 'public', 'images');
const DIST_DIR    = path.join(__dirname, 'dist');
const DB_DIR      = path.join(IMG_DIR, 'db');
const BREEDS_DB   = path.join(DB_DIR, 'breeds.json');
const USERS_DIR   = path.join(DB_DIR, 'users');
const BREEDS_BUNDLED = path.join(__dirname, 'public', 'breeds.json');
const PORT = process.env.PORT || 3001;

// Auth is only active when Google credentials are provided (skipped in local dev)
const AUTH_ENABLED = !!process.env.GOOGLE_CLIENT_ID;

const ALLOWED_EMAILS = new Set([
  'hamata25@gmail.com',
  'pauldenhertog256@gmail.com',
  'omarghanidenhertog@gmail.com',
  'mariamdenhertog256@gmail.com',
  'user@gmail.com',
]);

const ADMIN_EMAILS = new Set([
  'pauldenhertog256@gmail.com',
  'hamata25@gmail.com',
]);

// ── DB helpers ────────────────────────────────────────────────────────────────
async function loadDb(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function saveDb(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 2));
}

function getUserEmail(req) {
  return req.user?.email ?? 'dev@local';
}

function userMyherdFile(email) {
  // Use base64 of email as directory name to avoid filesystem issues
  const safe = Buffer.from(email).toString('base64url');
  return path.join(USERS_DIR, safe, 'myherd.json');
}

// ── Startup: migrate / seed breeds.json with IDs ─────────────────────────────
async function seedDb() {
  if (existsSync(BREEDS_DB)) return; // Already initialised

  // Load from old persistent file or bundled fallback
  let breeds = null;
  const oldPersistent = path.join(IMG_DIR, '_breeds.json');
  if (existsSync(oldPersistent)) {
    breeds = await loadDb(oldPersistent);
  }
  if (!breeds) {
    breeds = await loadDb(BREEDS_BUNDLED);
  }
  if (!breeds) {
    console.warn('No breeds source found — starting with empty list');
    breeds = [];
  }

  // Assign sequential IDs where missing
  let nextId = 1;
  breeds = breeds.map((b) => {
    if (!b.id) return { id: nextId++, ...b };
    nextId = Math.max(nextId, b.id + 1);
    return b;
  });

  await saveDb(BREEDS_DB, breeds);
  console.log(`DB seeded with ${breeds.length} breeds → ${BREEDS_DB}`);
}

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
}

// ── Auth logout (always available) ────────────────────────────────────────────
app.get('/auth/logout', (req, res) => {
  if (typeof req.logout === 'function') {
    req.logout(() => res.redirect('/'));
  } else {
    res.redirect('/');
  }
});

// ── Auth middleware ────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (!AUTH_ENABLED || req.isAuthenticated()) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

function requireAdmin(req, res, next) {
  if (!AUTH_ENABLED) return next(); // dev mode — all allowed
  const email = req.user?.email;
  if (!email || !ADMIN_EMAILS.has(email)) return res.status(403).json({ error: 'Forbidden' });
  next();
}

// ── API: who am I ─────────────────────────────────────────────────────────────
app.get('/api/me', (req, res) => {
  if (!AUTH_ENABLED) return res.json({ email: 'dev@local', name: 'Developer', isAdmin: true });
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthenticated' });
  res.json({ ...req.user, isAdmin: ADMIN_EMAILS.has(req.user.email) });
});

// ── API: breeds (master list) ─────────────────────────────────────────────────

// GET all breeds
app.get('/api/breeds', requireAuth, async (req, res) => {
  try {
    const breeds = await loadDb(BREEDS_DB) ?? [];
    res.json(breeds);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// PATCH one breed (admin only) — partial update to master list
app.patch('/api/breeds/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const breeds = await loadDb(BREEDS_DB) ?? [];
    const idx = breeds.findIndex((b) => b.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    breeds[idx] = { ...breeds[idx], ...req.body, id }; // id cannot be overwritten
    await saveDb(BREEDS_DB, breeds);
    res.json(breeds[idx]);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST new breed (admin only)
app.post('/api/breeds', requireAuth, requireAdmin, async (req, res) => {
  try {
    const breeds = await loadDb(BREEDS_DB) ?? [];
    const nextId = breeds.reduce((m, b) => Math.max(m, b.id ?? 0), 0) + 1;
    const newBreed = { id: nextId, name: '', origin: null, subspecies: null, purpose: null, imageUrl: null, wikiUrl: null, ...req.body, id: nextId };
    breeds.push(newBreed);
    await saveDb(BREEDS_DB, breeds);
    res.status(201).json(newBreed);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/breeds/import — replace entire master list (admin only)
// Accepts a JSON array; ensures every entry has a stable id
app.post('/api/breeds/import', requireAuth, requireAdmin, async (req, res) => {
  try {
    const incoming = req.body;
    if (!Array.isArray(incoming)) return res.status(400).json({ error: 'Expected array' });
    let nextId = 1;
    const breeds = incoming.map((b) => {
      if (b.id) { nextId = Math.max(nextId, b.id + 1); return b; }
      return { id: nextId++, ...b };
    });
    await saveDb(BREEDS_DB, breeds);
    res.json({ ok: true, count: breeds.length });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// DELETE breed (admin only)
app.delete('/api/breeds/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    let breeds = await loadDb(BREEDS_DB) ?? [];
    const before = breeds.length;
    breeds = breeds.filter((b) => b.id !== id);
    if (breeds.length === before) return res.status(404).json({ error: 'Not found' });
    await saveDb(BREEDS_DB, breeds);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── API: my herd (per-user private list) ──────────────────────────────────────

// GET user's herd
app.get('/api/myherd', requireAuth, async (req, res) => {
  try {
    const herd = await loadDb(userMyherdFile(getUserEmail(req))) ?? [];
    res.json(herd);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// PUT replace user's entire herd
app.put('/api/myherd', requireAuth, async (req, res) => {
  try {
    const herd = req.body;
    if (!Array.isArray(herd)) return res.status(400).json({ error: 'Expected array' });
    await saveDb(userMyherdFile(getUserEmail(req)), herd);
    res.json({ ok: true, count: herd.length });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── API: image upload ─────────────────────────────────────────────────────────
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

// ── Start ─────────────────────────────────────────────────────────────────────
await seedDb();
app.listen(PORT, () => console.log(`HerdHub → http://localhost:${PORT}`));
