// Simple image upload server — saves pasted/uploaded images to public/images/
import express from 'express';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IMG_DIR = path.join(__dirname, 'public', 'images');
const PORT = 3001;

const app = express();
app.use(express.json({ limit: '25mb' }));

// Allow Vite dev server to reach this
app.use((_, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
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

app.listen(PORT, () => console.log(`Upload server → http://localhost:${PORT}`));
