// Express server — HerdHub API + serves the built React frontend
import express from 'express';
import { writeFile, mkdir, readFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import session from 'express-session';
import bcrypt from 'bcryptjs';
import sharp from 'sharp';
railway link --service HerdHubimport archiver from 'archiver';
import unzipper from 'unzipper';
import compression from 'compression';

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
const PORT           = process.env.PORT || 5176;

// ── DB helpers ────────────────────────────────────────────────────────────────
/** Capitalize first letter, lowercase rest. Deduplicates case-insensitively. */
function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  const seen = new Map();
  for (const t of tags) {
    if (!t) continue;
    const norm = t.trim().charAt(0).toUpperCase() + t.trim().slice(1).toLowerCase();
    // Keep first occurrence wins on case conflict
    const key = norm.toLowerCase();
    if (!seen.has(key)) seen.set(key, norm);
  }
  return [...seen.values()];
}
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
        return { ...rest, tags: normalizeTags(tags) };
      }
      // Also normalize any existing tags that might be wrong case
      const normalized = normalizeTags(b.tags);
      if (normalized.join(',') !== b.tags.join(',')) { migrated = true; return { ...b, tags: normalized }; }
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
app.use(compression()); // gzip all responses
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
  // remember=true → 30-day persistent cookie; false → expires when browser closes
  const remember = req.body.remember !== false;
  if (remember) {
    req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000;
  } else {
    req.session.cookie.expires = false; // session cookie — cleared on browser close
  }
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

// POST /api/accounts — admin creates a new account directly
app.post('/api/accounts', requireAdmin, async (req, res) => {
  const { email, password, role = 'user' } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (!['user', 'admin'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  const accounts = await loadDb(ACCOUNTS_DB) ?? [];
  if (accounts.find((a) => a.email.toLowerCase() === email.toLowerCase())) {
    return res.status(409).json({ error: 'Email already registered' });
  }
  const newAccount = {
    id: Date.now() + Math.random(),
    email: email.toLowerCase(),
    passwordHash: await bcrypt.hash(password, 12),
    role,
    createdAt: new Date().toISOString(),
  };
  accounts.push(newAccount);
  await saveDb(ACCOUNTS_DB, accounts);
  const { passwordHash: _, ...safe } = newAccount;
  res.status(201).json(safe);
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
    // Strip migration-only fields to reduce response payload
    res.json(breeds.map(({ localImage: _, ...b }) => b));
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
    let body = { ...req.body };
    // If a new external imageUrl is provided, download it immediately and store locally
    if (body.imageUrl && /^https?:\/\//.test(body.imageUrl)) {
      try {
        const name = body.name ?? breeds[idx].name;
        body.imageUrl = await downloadAndSaveImage(body.imageUrl, id, name);
      } catch (e) {
        console.warn(`Image download failed on PATCH: ${e.message}`);
        // keep external URL — ensureLocalImages will retry on next startup
      }
    }
    breeds[idx] = { ...breeds[idx], ...body, id };
    if (body.tags) breeds[idx].tags = normalizeTags(body.tags);
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
    newBreed.tags = normalizeTags(newBreed.tags);
    // Download external imageUrl immediately so it's served locally
    if (newBreed.imageUrl && /^https?:\/\//.test(newBreed.imageUrl)) {
      try {
        newBreed.imageUrl = await downloadAndSaveImage(newBreed.imageUrl, nextId, newBreed.name);
      } catch (e) {
        console.warn(`Image download failed on POST breed: ${e.message}`);
      }
    }
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
      const tags = normalizeTags(b.tags ?? (b.purpose ? b.purpose.split('/').map(t => t.trim()) : []));
      if (b.id) { nextId = Math.max(nextId, b.id + 1); return { ...b, tags }; }
      return { id: nextId++, ...b, tags };
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
    const { name, breedId, dataUrl } = req.body;
    if (!name || !dataUrl) return res.status(400).json({ error: 'Missing name or dataUrl' });

    const nameSlug = name.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').toLowerCase();
    const stem = breedId ? `${breedId}_${nameSlug}_1` : nameSlug;
    const ext = dataUrl.match(/^data:image\/(\w+);/)?.[1]?.replace('jpeg', 'jpg') ?? 'jpg';
    const filename = `${stem}.${ext}`;

    const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
    await mkdir(IMG_DIR, { recursive: true });
    await writeFile(path.join(IMG_DIR, filename), Buffer.from(base64, 'base64'));

    res.json({ path: `/images/${filename}` });
    generateThumb(filename).catch(() => {});
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

// Thumbnail helpers
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif']);
const PUBLIC_IMG = path.join(__dirname, 'public', 'images');
const DIST_IMG   = path.join(DIST_DIR, 'images');
// Pre-downloaded images from the scrape script at the workspace root
const COW_IMG    = path.join(__dirname, '..', 'images');

/** Find the source file for a given image filename across all image locations. */
function findImageSrc(filename) {
  for (const dir of [IMG_DIR, DIST_IMG, PUBLIC_IMG, COW_IMG]) {
    const p = path.join(dir, filename);
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Download an external image URL (or copy from localImage), save locally as [id]_[name]_[slot][ext],
 * generate a thumbnail in the background, and return the local /images/... path.
 */
async function downloadAndSaveImage(externalUrl, breedId, breedName, slot = 1, localImageHint = null) {
  const nameSlug = breedName.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').toLowerCase();

  // Handle inline base64 data URLs — decode directly, no HTTP needed
  if (externalUrl.startsWith('data:')) {
    const m = externalUrl.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
    if (!m) throw new Error('Unrecognised data URL format');
    let mimeExt = '.' + m[1].split('+')[0]; // e.g. image/jpeg → .jpeg, image/svg+xml → .svg
    if (mimeExt === '.jpeg') mimeExt = '.jpg';
    if (!IMAGE_EXTS.has(mimeExt)) mimeExt = '.jpg';
    const filename = `${breedId}_${nameSlug}_${slot}${mimeExt}`;
    const dest = path.join(IMG_DIR, filename);
    if (!existsSync(dest)) {
      await mkdir(IMG_DIR, { recursive: true });
      await writeFile(dest, Buffer.from(m[2], 'base64'));
    }
    generateThumb(filename).catch(() => {});
    return `/images/${filename}`;
  }

  let ext;
  try { ext = path.extname(new URL(externalUrl).pathname).toLowerCase(); } catch { ext = ''; }
  // Try to infer ext from the localImage hint if the URL ext is unhelpful
  if (!IMAGE_EXTS.has(ext) && localImageHint) {
    ext = path.extname(localImageHint).toLowerCase();
  }
  if (!IMAGE_EXTS.has(ext)) ext = '.jpg';
  const filename = `${breedId}_${nameSlug}_${slot}${ext}`;
  const dest = path.join(IMG_DIR, filename);
  if (!existsSync(dest)) {
    await mkdir(IMG_DIR, { recursive: true });
    // Prefer copying from the pre-downloaded stash over fetching from internet
    const hint = localImageHint ? path.join(__dirname, '..', localImageHint) : null;
    if (hint && existsSync(hint)) {
      const { copyFile } = await import('fs/promises');
      await copyFile(hint, dest);
    } else {
      // Wikimedia (and many CDNs) require a proper User-Agent or they return 403
      const resp = await fetch(externalUrl, {
        signal: AbortSignal.timeout(20000),
        headers: { 'User-Agent': 'HerdHub/1.0 (https://github.com/pauldenhertog256/HerdHub; cattle breed catalogue)' },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      await writeFile(dest, Buffer.from(await resp.arrayBuffer()));
    }
  }
  generateThumb(filename).catch(() => {});
  return `/images/${filename}`;
}

// Deduplication: if concurrent requests arrive for the same thumb, share one promise
const thumbsInProgress = new Map();

/** Generate a 400×300 WebP thumbnail. Output name: [stem]_thumb.webp. Idempotent + concurrent-safe. */
async function generateThumb(filename) {
  const stem = path.basename(filename, path.extname(filename));
  const thumbName = `${stem}_thumb.webp`;
  const dst = path.join(THUMB_DIR, thumbName);
  if (existsSync(dst)) return dst;
  if (thumbsInProgress.has(thumbName)) return thumbsInProgress.get(thumbName);
  const promise = (async () => {
    const src = findImageSrc(filename);
    if (!src) return null;
    await mkdir(THUMB_DIR, { recursive: true });
    await sharp(src)
      .resize({ width: 400, height: 300, fit: 'cover', position: 'centre' })
      .webp({ quality: 80 })
      .toFile(dst);
    return dst;
  })();
  promise.finally(() => thumbsInProgress.delete(thumbName));
  thumbsInProgress.set(thumbName, promise);
  return promise;
}

// GET /api/thumb/:filename — serve WebP thumbnail for locally-stored images.
// If thumbnail not yet cached, serve the original immediately and generate in background.
app.get('/api/thumb/:filename', async (req, res) => {
  const filename = req.params.filename;
  if (!filename || filename.includes('..') || filename.includes('/')) return res.status(400).end();
  if (!IMAGE_EXTS.has(path.extname(filename).toLowerCase())) return res.status(400).end();

  const stem = path.basename(filename, path.extname(filename));
  const thumbName = `${stem}_thumb.webp`;
  const dst = path.join(THUMB_DIR, thumbName);
  if (existsSync(dst)) {
    res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
    res.setHeader('Content-Type', 'image/webp');
    return res.sendFile(dst);
  }

  // Not cached yet: serve the original while generating thumb in background
  const src = findImageSrc(filename);
  if (!src) return res.status(404).end();
  generateThumb(filename).catch(() => {});
  res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
  res.sendFile(src);
});

// ── ZIP export / import ──────────────────────────────────────────────────────

/** Stream a zip archive of breeds + their referenced images to the response. */
async function buildBreedZip(breeds, res, filename) {
  const archive = archiver('zip', { zlib: { level: 6 } });
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  archive.pipe(res);
  archive.append(JSON.stringify(breeds, null, 2), { name: 'breeds.json' });
  const seen = new Set();
  for (const b of breeds) {
    if (!b.imageUrl) continue;
    const fn = path.basename(b.imageUrl);
    if (seen.has(fn)) continue;
    seen.add(fn);
    const src = findImageSrc(fn);
    if (src) archive.file(src, { name: `images/${fn}` });
  }
  await archive.finalize();
}

/** Extract breeds.json + images from a zip buffer. Returns { breeds, imageCount }. */
async function extractBreedZip(buf) {
  await mkdir(IMG_DIR, { recursive: true });
  const directory = await unzipper.Open.buffer(buf);
  let breedsData = null;
  let imageCount = 0;
  for (const file of directory.files) {
    if (file.type === 'Directory') continue;
    if (file.path === 'breeds.json') {
      breedsData = JSON.parse((await file.buffer()).toString('utf8'));
    } else if (file.path.startsWith('images/')) {
      const fn = path.basename(file.path);
      if (!fn || fn.startsWith('.')) continue;
      await writeFile(path.join(IMG_DIR, fn), await file.buffer());
      imageCount++;
      generateThumb(fn).catch(() => {});
    }
  }
  if (!breedsData) throw new Error('breeds.json not found in zip');
  if (!Array.isArray(breedsData)) throw new Error('breeds.json must be a JSON array');
  return { breedsData, imageCount };
}

// GET /api/export-zip — master breeds + images (admin)
app.get('/api/export-zip', requireAdmin, async (req, res) => {
  try {
    const breeds = await loadDb(BREEDS_DB) ?? [];
    const date = new Date().toISOString().slice(0, 10);
    await buildBreedZip(breeds, res, `Export_All_${date}.zip`);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: String(err) });
  }
});

// POST /api/import-zip — replace master breeds + images from zip (admin)
app.post('/api/import-zip', requireAdmin, express.raw({ type: '*/*', limit: '200mb' }), async (req, res) => {
  try {
    const { breedsData, imageCount } = await extractBreedZip(req.body);
    let nextId = 1;
    const breeds = breedsData.map((b) => {
      const tags = normalizeTags(b.tags ?? []);
      if (b.id) { nextId = Math.max(nextId, b.id + 1); return { ...b, tags }; }
      return { id: nextId++, ...b, tags };
    });
    await saveDb(BREEDS_DB, breeds);
    res.json({ ok: true, breeds: breeds.length, images: imageCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/myherd/export-zip — user's My Herd + images (any logged-in user)
app.get('/api/myherd/export-zip', requireUser, async (req, res) => {
  try {
    const herd = await loadDb(userMyherdFile(req.session.email)) ?? [];
    const date = new Date().toISOString().slice(0, 10);
    await buildBreedZip(herd, res, `Export_My_Herd_${date}.zip`);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: String(err) });
  }
});

// POST /api/myherd/import-zip — replace user's My Herd + images from zip
app.post('/api/myherd/import-zip', requireUser, express.raw({ type: '*/*', limit: '200mb' }), async (req, res) => {
  try {
    const { breedsData, imageCount } = await extractBreedZip(req.body);
    await saveDb(userMyherdFile(req.session.email), breedsData);
    res.json({ ok: true, breeds: breedsData.length, images: imageCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

// ── Static frontend (production) ──────────────────────────────────────────────
app.use(express.static(DIST_DIR));
// Images and thumbs are named with breed IDs — safe to cache for 30 days
app.use('/images', express.static(IMG_DIR, { maxAge: '30d', immutable: true }));

// SPA fallback — all non-API routes serve index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(DIST_DIR, 'index.html'));
});

/** Warm the thumbnail cache in the background at startup. Runs 10 concurrent. */
async function ensureAllThumbs() {
  try {
    const dirs = [IMG_DIR, PUBLIC_IMG, DIST_IMG];
    const seen = new Set();
    for (const dir of dirs) {
      if (!existsSync(dir)) continue;
      const files = await readdir(dir);
      for (const f of files) {
        if (IMAGE_EXTS.has(path.extname(f).toLowerCase())) seen.add(f);
      }
    }
    if (!seen.size) return;
    await mkdir(THUMB_DIR, { recursive: true });
    const arr = [...seen];
    const BATCH = 10;
    for (let i = 0; i < arr.length; i += BATCH) {
      await Promise.all(arr.slice(i, i + BATCH).map((f) => generateThumb(f).catch(() => {})));
    }
    console.log(`Thumbnails ready (${arr.length} images)`);
  } catch (e) {
    console.warn('ensureAllThumbs error:', e.message);
  }
}

/**
 * Download all external imageUrls in breeds.json to IMG_DIR, update DB records
 * to local /images/... paths. Runs at startup in background. Restart-safe:
 * already-downloaded files are skipped, DB is saved after each batch.
 */
async function ensureLocalImages() {
  try {
    let breeds = await loadDb(BREEDS_DB) ?? [];
    const external = breeds.filter((b) => b.imageUrl && (b.imageUrl.startsWith('data:') || /^https?:\/\//.test(b.imageUrl)));
    if (!external.length) return;
    console.log(`Localising ${external.length} external breed images (copying from local stash where available)…`);

    let saved = 0, failed = 0, dirty = false;
    for (const b of external) {
      const idx = breeds.findIndex((x) => x.id === b.id);
      if (idx === -1) continue;
      try {
        const localUrl = await downloadAndSaveImage(b.imageUrl, b.id, b.name, 1, b.localImage ?? null);
        breeds[idx] = { ...breeds[idx], imageUrl: localUrl };
        dirty = true;
        saved++;
        // Persist every 10 downloads so progress survives a restart
        if (saved % 10 === 0) { await saveDb(BREEDS_DB, breeds); dirty = false; }
      } catch (err) {
        console.warn(`  Failed "${b.name}": ${err.message}`);
        failed++;
      }
      // 500 ms between requests — avoids Wikimedia 429 rate-limiting
      if (/^https?:\/\//.test(b.imageUrl)) await new Promise((r) => setTimeout(r, 500));
    }
    if (dirty) await saveDb(BREEDS_DB, breeds);
    console.log(`Image localisation done — ${saved} saved, ${failed} failed.`);
  } catch (e) {
    console.warn('ensureLocalImages error:', e.message);
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────
await seedDb();
// These run in background — server is ready immediately
ensureLocalImages().then(() => ensureAllThumbs());
app.listen(PORT, () => console.log(`HerdHub → http://localhost:${PORT}`));
