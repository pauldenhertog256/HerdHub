/**
 * upload-local-images.mjs
 *
 * Reads all .jpg/.png/.webp files from ./images/, matches each to a breed
 * (by converting filename → breed name), then for each breed whose imageUrl
 * is still an external http URL:
 *   1. Uploads the image via POST /api/upload-image
 *   2. PATCHes the breed's imageUrl with the returned local path
 *
 * Usage (PowerShell):
 *   node upload-local-images.mjs
 *   node upload-local-images.mjs --dry-run
 *   node upload-local-images.mjs --base-url http://localhost:5176
 */

import { readdir, readFile } from 'fs/promises';
import path from 'path';

const BASE_URL = process.argv.includes('--base-url')
  ? process.argv[process.argv.indexOf('--base-url') + 1]
  : 'https://herdhub-production-7da5.up.railway.app';

const DRY_RUN = process.argv.includes('--dry-run');

const ADMIN_EMAIL    = 'pauldenhertog256@gmail.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASS ?? 'PipoPassword*';

const IMAGES_DIR = new URL('./images/', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');

// ── helpers ──────────────────────────────────────────────────────────────────

function slugToName(filename) {
  // "Aberdeen_Angus.jpg" → "Aberdeen Angus"
  return path.basename(filename, path.extname(filename)).replace(/_/g, ' ');
}

function toDataUrl(buffer, ext) {
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
             : ext === 'png'  ? 'image/png'
             : ext === 'webp' ? 'image/webp'
             : ext === 'gif'  ? 'image/gif'
             : 'image/jpeg';
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Base URL : ${BASE_URL}`);
  console.log(`Dry run  : ${DRY_RUN}`);
  console.log(`Images   : ${IMAGES_DIR}\n`);

  // 1. Log in and grab session cookie
  console.log('Logging in...');
  const loginRes = await fetch(`${BASE_URL}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  if (!loginRes.ok) {
    console.error('Login failed:', await loginRes.text());
    process.exit(1);
  }
  const cookie = loginRes.headers.get('set-cookie');
  if (!cookie) { console.error('No session cookie received'); process.exit(1); }
  const sessionCookie = cookie.split(';')[0]; // just the name=value part
  console.log('Logged in.\n');

  const authHeaders = {
    'Cookie': sessionCookie,
    'Content-Type': 'application/json',
  };

  // 2. Fetch all breeds from production
  const breedsRes = await fetch(`${BASE_URL}/api/breeds`);
  const breeds = await breedsRes.json();

  // External = still pointing at http(s) URLs
  const external = breeds.filter(b => /^https?:\/\//.test(b.imageUrl ?? ''));
  console.log(`Breeds total: ${breeds.length} | Still external: ${external.length}\n`);

  // 3. Read local image files and build a map: lowercased-name → { file, ext, buffer }
  const files = await readdir(IMAGES_DIR);
  const imageMap = new Map(); // lowercased breed name → file path
  for (const f of files) {
    const ext = path.extname(f).slice(1).toLowerCase();
    if (!['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) continue;
    const name = slugToName(f).toLowerCase();
    imageMap.set(name, { filePath: path.join(IMAGES_DIR, f), ext });
  }
  console.log(`Local image map: ${imageMap.size} entries\n`);

  // 4. Process each external breed
  let uploaded = 0, skipped = 0, failed = 0;

  for (const breed of external) {
    const key = breed.name.toLowerCase();
    const entry = imageMap.get(key);

    if (!entry) {
      console.log(`  [SKIP] "${breed.name}" — no local file`);
      skipped++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`  [DRY]  "${breed.name}" → ${entry.filePath}`);
      uploaded++;
      continue;
    }

    try {
      // 4a. Read file and encode
      const buffer = await readFile(entry.filePath);
      const dataUrl = toDataUrl(buffer, entry.ext);

      // 4b. Upload image
      const upRes = await fetch(`${BASE_URL}/api/upload-image`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ name: breed.name, breedId: breed.id, dataUrl }),
      });
      if (!upRes.ok) {
        const err = await upRes.text();
        console.error(`  [FAIL] "${breed.name}" upload: ${upRes.status} ${err}`);
        failed++;
        continue;
      }
      const { path: localPath } = await upRes.json();

      // 4c. Patch breed imageUrl
      const patchRes = await fetch(`${BASE_URL}/api/breeds/${breed.id}`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({ imageUrl: localPath }),
      });
      if (!patchRes.ok) {
        const err = await patchRes.text();
        console.error(`  [FAIL] "${breed.name}" patch: ${patchRes.status} ${err}`);
        failed++;
        continue;
      }

      console.log(`  [OK]   "${breed.name}" → ${localPath}`);
      uploaded++;

      // Small delay to be polite to the server
      await sleep(100);
    } catch (e) {
      console.error(`  [ERR]  "${breed.name}": ${e.message}`);
      failed++;
    }
  }

  console.log(`\nDone. Uploaded: ${uploaded} | Skipped (no local): ${skipped} | Failed: ${failed}`);
}

main().catch(err => { console.error(err); process.exit(1); });
