// Vercel Serverless Function — replaces server.js for production
// Receives a base64 dataUrl, uploads to Vercel Blob, returns the public URL.
//
// Setup (one time):
//   Vercel dashboard → Storage → Create Blob store → link to this project.
//   The BLOB_READ_WRITE_TOKEN env var is added automatically.

import { put } from '@vercel/blob';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { name, dataUrl } = req.body ?? {};
    if (!name || !dataUrl) {
      return res.status(400).json({ error: 'Missing name or dataUrl' });
    }

    const slug = name.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_');
    const ext = (dataUrl.match(/^data:image\/(\w+);/)?.[1] ?? 'jpeg').replace('jpeg', 'jpg');
    const filename = `cattle-breeds/${slug}.${ext}`;
    const contentType = `image/${ext === 'jpg' ? 'jpeg' : ext}`;

    const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64, 'base64');

    const blob = await put(filename, buffer, { access: 'public', contentType });

    res.json({ path: blob.url });
  } catch (err) {
    console.error('[upload-image]', err);
    res.status(500).json({ error: String(err) });
  }
}
