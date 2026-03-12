// Express server — image upload API + serves the built React frontend
import express from 'express';
import { writeFile, mkdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IMG_DIR = path.join(__dirname, 'public', 'images');
const DIST_DIR = path.join(__dirname, 'dist');
// Persistent breeds JSON lives in the volume-mounted images dir so it survives redeploys
const BREEDS_PERSISTENT = path.join(IMG_DIR, '_breeds.json');
const BREEDS_BUNDLED    = path.join(__dirname, 'public', 'breeds.json');
const PORT = process.env.PORT || 3001;

const app = express();
app.use(express.json({ limit: '25mb' }));

// ── API ──────────────────────────────────────────────────────────────────────

// Return persisted breeds if available, else fall back to bundled
app.get('/api/breeds', async (req, res) => {
  try {
    const src = existsSync(BREEDS_PERSISTENT) ? BREEDS_PERSISTENT : BREEDS_BUNDLED;
    const data = await readFile(src, 'utf8');
    res.type('application/json').send(data);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Save the full breeds array (called when user clicks Save breeds.json)
app.post('/api/save-breeds', async (req, res) => {
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

app.post('/api/upload-image', async (req, res) => {
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

// ── Static frontend (production) ─────────────────────────────────────────────

app.use(express.static(DIST_DIR));
app.use('/images', express.static(path.join(__dirname, 'public', 'images')));

// SPA fallback — all non-API routes serve index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(DIST_DIR, 'index.html'));
});

app.listen(PORT, () => console.log(`HerdHub → http://localhost:${PORT}`));
