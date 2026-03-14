// Express server — HerdHub API + serves the built React frontend
import express from 'express';
import { writeFile, mkdir, readFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import session from 'express-session';
import bcrypt from 'bcryptjs';
import sharp from 'sharp';

const __dirname      = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR       = process.env.DATA_DIR || path.join(__dirname, 'data');
const IMG_DIR        = path.join(DATA_DIR, 'images');
const THUMB_DIR      = path.join(IMG_DIR, 'thumbs');
const DIST_DIR       = path.join(__dirname, 'dist');
const DB_DIR         = path.join(DATA_DIR, 'db');
const BREEDS_DB      = path.join(DB_DIR, 'breeds.json');
const ACCOUNTS_DB    = path.join(DB_DIR, 'accounts.json');
const USERS_DIR      = path.join(DB_DIR, 'users');
const BREEDS_BUNDLED = path.join(__dirname, 'public', 'breeds.json');
const PORT           = process.env.PORT || 3001;

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

function userMyherdFile(email) {
  // Use base64 of email as directory name to avoid filesystem issues
  const safe = Buffer.from(email).toString('base64url');
  return path.join(USERS_DIR, safe, 'myherd.json');
}

function sessionUser(req) {
  return req.session?.user ?? null;
}

// ── Startup: migrate / seed breeds.json with IDs ─────────────────────────────
async function seedDb() {
  // Breeds
  if (!existsSync(BREEDS_DB)) {
    let breeds = null;
    const oldPersistent = path.join(IMG_DIR, '_breeds.json');
    if (existsSync(oldPersistent)) breeds = await loadDb(oldPersistent);
    if (!breeds) breeds = await loadDb(BREEDS_BUNDLED) ?? [];
    let nextId = 1;
    breeds = breeds.map((b) => {
      if (b.id) { nextId = Math.max(nextId, b.id + 1); return b; }
      return { id: nextId++, ...b };
    });
    await saveDb(BREEDS_DB, breeds);
    console.log(`DB seeded — ${breeds.length} breeds`);
  }

  // Migration: purpose string → tags array
  {
    let breeds = await loadDb(BREEDS_DB) ?? [];
    let migrated = false;
    breeds = breeds.map((b) => {
      if (!Array.isArray(b.tags)) {
        const tags = b.purpose ? b.purpose.split('/').map((t) => t.trim()).filter(Boolean) : [];
        const { purpose, ...rest } = b;
        migrated = true;
        return { ...rest, tags };
      }
      return b;
    });
    if (migrated) { await saveDb(BREEDS_DB, breeds); console.log('Migrated purpose → tags'); }
  }

  // Accounts — seed hardcoded admins + optional env-var admin
  let accounts = await loadDb(ACCOUNTS_DB) ?? [];
  const adminSeeds = [
    { email: 'hamata25@gmail.com',         password: 'PipoPassword*' },
    { email: 'pauldenhertog256@gmail.com', password: 'PipoPassword*' },
  ];
  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASS) {
    adminSeeds.push({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASS });
  }
  let changed = false;
  for (const seed of adminSeeds) {
    if (!accounts.find((a) => a.email === seed.email)) {
      accounts.push({
        id: Date.now() + Math.random(),
        email: seed.email,
        passwordHash: await bcrypt.hash(seed.password, 12),
        role: 'admin',
        createdAt: new Date().toISOString(),
      });
      console.log(`Admin seeded: ${seed.email}`);
      changed = true;
    }
  }
  if (changed) await saveDb(ACCOUNTS_DB, accounts);
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

// ── Auth middleware ────────────────────────────────────────────────────────────
function requireUser(req, res, next) {
  if (!sessionUser(req)) return res.status(401).json({ error: 'Login required' });
  next();
}

function requireAdmin(req, res, next) {
  const u = sessionUser(req);
  if (!u || u.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  next();
}

// ── API: auth ─────────────────────────────────────────────────────────────────

app.get('/api/me', (req, res) => {
  const u = sessionUser(req);
  if (!u) return res.json({ role: 'guest' });
  res.json({ email: u.email, role: u.role, impersonating: !!req.session.adminBackup });
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const accounts = await loadDb(ACCOUNTS_DB) ?? [];
  const account = accounts.find((a) => a.email.toLowerCase() === email.toLowerCase());
  if (!account) return res.status(401).json({ error: 'Invalid email or password' });
  const ok = await bcrypt.compare(password, account.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Invalid email or password' });
  req.session.user = { email: account.email, role: account.role };
  res.json({ email: account.email, role: account.role });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.post('/api/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const accounts = await loadDb(ACCOUNTS_DB) ?? [];
  if (accounts.find((a) => a.email.toLowerCase() === email.toLowerCase())) {
    return res.status(409).json({ error: 'Email already registered' });
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const newAccount = {
    id: Date.now() + Math.random(),
    email: email.toLowerCase(),
    passwordHash,
    role: 'user',
    createdAt: new Date().toISOString(),
  };
  accounts.push(newAccount);
  await saveDb(ACCOUNTS_DB, accounts);
  req.session.user = { email: newAccount.email, role: newAccount.role };
  res.status(201).json({ email: newAccount.email, role: newAccount.role });
});

// ── API: account management (admin only) ──────────────────────────────────────

app.get('/api/accounts', requireAdmin, async (req, res) => {
  const accounts = await loadDb(ACCOUNTS_DB) ?? [];
  res.json(accounts.map(({ passwordHash: _, ...rest }) => rest));
});

app.patch('/api/accounts/:id', requireAdmin, async (req, res) => {
  const accounts = await loadDb(ACCOUNTS_DB) ?? [];
  const idx = accounts.findIndex((a) => String(a.id) === String(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const { role, password } = req.body;
  if (role) accounts[idx].role = role;
  if (password) {
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    accounts[idx].passwordHash = await bcrypt.hash(password, 12);
  }
  await saveDb(ACCOUNTS_DB, accounts);
  const { passwordHash: _, ...safe } = accounts[idx];
  res.json(safe);
});

app.delete('/api/accounts/:id', requireAdmin, async (req, res) => {
  let accounts = await loadDb(ACCOUNTS_DB) ?? [];
  const before = accounts.length;
  accounts = accounts.filter((a) => String(a.id) !== String(req.params.id));
  if (accounts.length === before) return res.status(404).json({ error: 'Not found' });
  await saveDb(ACCOUNTS_DB, accounts);
  res.json({ ok: true });
});

// ── API: admin impersonation ───────────────────────────────────────────────────

app.post('/api/impersonate/:id', requireAdmin, async (req, res) => {
  if (req.session.adminBackup) return res.status(400).json({ error: 'Already impersonating' });
  const accounts = await loadDb(ACCOUNTS_DB) ?? [];
  const target = accounts.find((a) => String(a.id) === String(req.params.id));
  if (!target) return res.status(404).json({ error: 'Account not found' });
  req.session.adminBackup = req.session.user;
  req.session.user = { email: target.email, role: target.role };
  res.json({ email: target.email, role: target.role, impersonating: true });
});

app.post('/api/unimpersonate', (req, res) => {
  if (!req.session?.adminBackup) return res.status(400).json({ error: 'Not impersonating' });
  req.session.user = req.session.adminBackup;
  delete req.session.adminBackup;
  res.json({ email: req.session.user.email, role: req.session.user.role });
});

// GET all breeds — no auth, guests can browse
app.get('/api/breeds', async (req, res) => {
  try {
    const breeds = await loadDb(BREEDS_DB) ?? [];
    res.json(breeds);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// PATCH one breed (admin only) — partial update to master list
app.patch('/api/breeds/:id', requireAdmin, async (req, res) => {
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
app.post('/api/breeds', requireAdmin, async (req, res) => {
  try {
    const breeds = await loadDb(BREEDS_DB) ?? [];
    const nextId = breeds.reduce((m, b) => Math.max(m, b.id ?? 0), 0) + 1;
    const newBreed = { id: nextId, name: '', origin: null, subspecies: null, tags: [], imageUrl: null, wikiUrl: null, ...req.body, id: nextId };
    breeds.push(newBreed);
    await saveDb(BREEDS_DB, breeds);
    res.status(201).json(newBreed);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/breeds/import — replace entire master list (admin only)
// Accepts a JSON array; ensures every entry has a stable id
app.post('/api/breeds/import', requireAdmin, async (req, res) => {
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
app.delete('/api/breeds/:id', requireAdmin, async (req, res) => {
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

// ── API: my herd (registered users only) ─────────────────────────────────────

// GET user's herd
app.get('/api/myherd', requireUser, async (req, res) => {
  try {
    const herd = await loadDb(userMyherdFile(sessionUser(req).email)) ?? [];
    res.json(herd);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// PUT replace user's entire herd
app.put('/api/myherd', requireUser, async (req, res) => {
  try {
    const herd = req.body;
    if (!Array.isArray(herd)) return res.status(400).json({ error: 'Expected array' });
    await saveDb(userMyherdFile(sessionUser(req).email), herd);
    res.json({ ok: true, count: herd.length });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── API: image upload (registered users only) ─────────────────────────────────
app.post('/api/upload-image', requireUser, async (req, res) => {
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
    // Generate thumbnail in background — don't block the response
    generateThumb(filename).catch((e) => console.warn('Thumb gen failed:', e.message));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

// ── Static frontend (production) ──────────────────────────────────────────────
app.use(express.static(DIST_DIR));
app.use('/images', express.static(IMG_DIR));
// Thumbnails served from thumbs subdir (already covered by /images static above via path)

// SPA fallback — all non-API routes serve index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(DIST_DIR, 'index.html'));
});

// ── Thumbnail helpers ────────────────────────────────────────────────────────
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif']);

/** Resize one image to a 400px-wide thumbnail. Skips if thumb already exists. */
async function generateThumb(filename) {
  const src = path.join(IMG_DIR, filename);
  const dst = path.join(THUMB_DIR, filename);
  if (existsSync(dst)) return; // already cached
  await mkdir(THUMB_DIR, { recursive: true });
  await sharp(src)
    .resize({ width: 400, height: 300, fit: 'cover', position: 'centre' })
    .toFile(dst);
}

/** Walk IMG_DIR and generate any missing thumbnails in the background. */
async function ensureAllThumbs() {
  try {
    await mkdir(THUMB_DIR, { recursive: true });
    const files = await readdir(IMG_DIR);
    const images = files.filter((f) => IMAGE_EXTS.has(path.extname(f).toLowerCase()));
    // Process sequentially to avoid saturating CPU on startup
    for (const f of images) {
      await generateThumb(f).catch((e) => console.warn(`Thumb skip ${f}:`, e.message));
    }
    if (images.length) console.log(`Thumbnails ready (${images.length} images)`);
  } catch (e) {
    console.warn('ensureAllThumbs error:', e.message);
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────
await seedDb();
// Thumbnail generation runs in background — server is ready immediately
ensureAllThumbs();
app.listen(PORT, () => console.log(`HerdHub → http://localhost:${PORT}`));
