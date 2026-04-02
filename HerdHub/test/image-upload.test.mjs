/**
 * Image upload & thumbnail tests
 *
 * Run with:
 *   TEST_BASE_URL=http://localhost:5176 node --test test/image-upload.test.mjs
 *
 * Setup / teardown:
 *   - Creates a dedicated test admin account (testadmin_<runId>@test.invalid)
 *     so real admin credentials are never used or required.
 *   - Every test that creates a breed deletes it afterwards.
 *   - The test admin account is deleted at the end of the run.
 *
 * Verifies:
 *   1.  Upload returns a path with ?t= cache-buster
 *   2.  The raw image file is written to disk
 *   3.  Thumbnail is served (and is webp) after upload
 *   4.  Re-uploading the same breed regenerates a different thumbnail
 *   5.  PATCH /api/breeds/:id strips ?t= before saving to DB
 *   6.  PUT /api/myherd strips ?t= from all imageUrls before saving
 *   7.  /api/thumb returns 404 for unknown images
 *   8.  /api/thumb blocks path traversal
 *   9.  Upload requires authentication
 *
 * External-URL image flow (same for all three save paths):
 *  10.  POST  /api/breeds       -- Add New Breed   (reference implementation)
 *  11.  PATCH /api/breeds/:id   -- Edit master list
 *  12.  PUT   /api/myherd       -- Edit My Herd
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// ── Globals ───────────────────────────────────────────────────────────────────
let baseUrl;
let testRunId;
let testIdx = 0;
let RED_DATA_URL;
let BLUE_DATA_URL;

// Test admin credentials — created fresh each run, deleted on teardown
let TEST_ADMIN_EMAIL;
let TEST_ADMIN_PASSWORD;
let testAdminId;      // account id, for deletion
let testAdminCk;      // session cookie

// Real seeded admin used only to bootstrap the test admin account
const SEED_ADMIN_EMAIL    = process.env.SEED_ADMIN_EMAIL    ?? 'pauldenhertog256@gmail.com';
const SEED_ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? (() => { throw new Error('Set SEED_ADMIN_PASSWORD env var'); })();

function nextName() { return `TestBreed_${testRunId}_${++testIdx}`; }

async function buildTestImages() {
  const { default: sharp } = await import('sharp');
  const redBuf  = await sharp({ create: { width: 10, height: 10, channels: 3, background: { r: 255, g: 0,   b: 0   } } }).jpeg().toBuffer();
  const blueBuf = await sharp({ create: { width: 10, height: 10, channels: 3, background: { r: 0,   g: 0,   b: 255 } } }).jpeg().toBuffer();
  RED_DATA_URL  = `data:image/jpeg;base64,${redBuf.toString('base64')}`;
  BLUE_DATA_URL = `data:image/jpeg;base64,${blueBuf.toString('base64')}`;
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────
async function apiPost(url, body, headers = {}) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

async function login(email, password) {
  const r = await apiPost(`${baseUrl}/api/login`, { email, password });
  const data = await r.json();
  assert.equal(r.status, 200, `Login failed for ${email}: ${JSON.stringify(data)}`);
  return r.headers.get('set-cookie').split(';')[0];
}

async function registerAndLoginUser(email, password = 'TestPass123!') {
  await apiPost(`${baseUrl}/api/register`, { email, password }).catch(() => {});
  const ck = await login(email, password);
  const accs = await (await fetch(`${baseUrl}/api/accounts`, { headers: { Cookie: testAdminCk } })).json();
  const acc = accs.find((a) => a.email === email);
  return { ck, id: acc?.id };
}

/** Delete an account via the admin API (best-effort, for cleanup). */
async function deleteAccount(id) {
  if (!id) return;
  await fetch(`${baseUrl}/api/accounts/${id}`, {
    method: 'DELETE',
    headers: { Cookie: testAdminCk },
  });
}

/** Create a fresh breed in the master list. Returns { id, name, cookie }. */
async function createTestBreed(name = nextName()) {
  const r = await apiPost(`${baseUrl}/api/breeds`, { name }, { Cookie: testAdminCk });
  assert.equal(r.status, 201, `Failed to create test breed "${name}": ${r.status}`);
  const breed = await r.json();
  return breed;
}

/** Delete a breed from the master list (cleanup). */
async function deleteBreed(id) {
  await fetch(`${baseUrl}/api/breeds/${id}`, {
    method: 'DELETE',
    headers: { Cookie: testAdminCk },
  });
}

// External image URL used for the "paste a URL" flow tests.
// Served by the Vite dev server from its public/ directory — no internet access needed.
// The API server (port 5176) fetches this from Vite (port 5175) to exercise the
// "download external URL → save locally" code path.
const EXT_IMAGE_URL_A = 'http://localhost:5175/test_cow.jpg';

/**
 * Upload a tiny blue JPEG for a given breed and return its absolute http:// URL
 * (served from localhost:5176/images/...).  Used as the second distinct external
 * URL in round-2 overwrite tests so content1 !== content2 can be asserted.
 */
async function seedExternalUrl(breedId, breedName) {
  const r = await apiPost(
    `${baseUrl}/api/upload-image`,
    { name: breedName, breedId, dataUrl: BLUE_DATA_URL, context: 'master' },
    { Cookie: testAdminCk },
  );
  assert.equal(r.status, 200, `Seed upload failed: ${r.status}`);
  const { path } = await r.json();
  return `${baseUrl}${path.split('?')[0]}`;
}

/**
 * Assert the three invariants for every external-URL save path:
 *   a) savedImageUrl is a local /images/ path (not http://)
 *   b) that file is served (HTTP 200)
 *   c) a WebP thumbnail is available
 */
async function assertExternalUrlFlow(savedImageUrl, label) {
  assert.ok(
    savedImageUrl?.startsWith('/images/'),
    `[${label}] imageUrl should be a local /images/ path, got: ${savedImageUrl}`,
  );
  assert.ok(
    !savedImageUrl.startsWith('http'),
    `[${label}] imageUrl should not remain external, got: ${savedImageUrl}`,
  );

  const imgRes = await fetch(`${baseUrl}${savedImageUrl}`);
  assert.equal(imgRes.status, 200, `[${label}] local image file not served at ${savedImageUrl}`);

  const relpath = savedImageUrl.replace('/images/', '');
  // Thumbnail is generated synchronously on the server before the response arrives,
  // so the first attempt should succeed. A few retries guard against slow filesystems.
  let thumbRes;
  for (let i = 0; i < 5; i++) {
    thumbRes = await fetch(`${baseUrl}/api/thumb/${relpath}`);
    if (thumbRes.status === 200 && thumbRes.headers.get('content-type') === 'image/webp') break;
    if (i < 4) await new Promise((r) => setTimeout(r, 300));
  }
  assert.equal(thumbRes.status, 200, `[${label}] thumbnail not available for ${relpath}`);
  assert.equal(thumbRes.headers.get('content-type'), 'image/webp', `[${label}] thumbnail should be webp`);
}

// ─────────────────────────────────────────────────────────────────────────────

test('image upload & thumbnail', { skip: !process.env.TEST_BASE_URL }, async (t) => {
  baseUrl   = process.env.TEST_BASE_URL;
  testRunId = Date.now();
  await buildTestImages();

  // ── Setup: create a dedicated test admin account ───────────────────────────
  TEST_ADMIN_EMAIL    = `testadmin_${testRunId}@test.invalid`;
  TEST_ADMIN_PASSWORD = `TestAdmin${testRunId}!`;
  const seedCk = await login(SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD);

  const createRes = await apiPost(
    `${baseUrl}/api/accounts`,
    { email: TEST_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD, role: 'admin' },
    { Cookie: seedCk },
  );
  const createBody = await createRes.text();
  assert.equal(createRes.status, 201, `Failed to create test admin: ${createRes.status} ${createBody}`);
  const created = JSON.parse(createBody);
  testAdminId = created.id;
  testAdminCk = await login(TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD);

  // ── 1. Basic upload ────────────────────────────────────────────────────────
  await t.test('upload returns path with ?t= cache-buster', async () => {
    const breed = await createTestBreed();
    try {
      const r = await apiPost(`${baseUrl}/api/upload-image`,
        { name: breed.name, breedId: breed.id, dataUrl: RED_DATA_URL, context: 'master' },
        { Cookie: testAdminCk });
      assert.equal(r.status, 200);
      const { path: imgPath } = await r.json();
      assert.ok(imgPath?.startsWith('/images/'), `path should start with /images/, got: ${imgPath}`);
      assert.ok(imgPath.includes('?t='), `path should contain ?t= cache-buster, got: ${imgPath}`);
    } finally { await deleteBreed(breed.id); }
  });

  await t.test('image file is written to disk', async () => {
    const breed = await createTestBreed();
    try {
      const r = await apiPost(`${baseUrl}/api/upload-image`,
        { name: breed.name, breedId: breed.id, dataUrl: RED_DATA_URL, context: 'master' },
        { Cookie: testAdminCk });
      assert.equal(r.status, 200);
      const { path: imgPath } = await r.json();
      const imgRes = await fetch(`${baseUrl}${imgPath.split('?')[0]}`);
      assert.equal(imgRes.status, 200, `Image file not served at ${imgPath}`);
    } finally { await deleteBreed(breed.id); }
  });

  await t.test('thumbnail is served (webp) after upload', async () => {
    const breed = await createTestBreed();
    try {
      const r = await apiPost(`${baseUrl}/api/upload-image`,
        { name: breed.name, breedId: breed.id, dataUrl: RED_DATA_URL, context: 'master' },
        { Cookie: testAdminCk });
      assert.equal(r.status, 200);
      const { path: imgPath } = await r.json();
      const filename = imgPath.split('?')[0].replace('/images/', '');
      let thumbRes;
      for (let i = 0; i < 20; i++) {
        thumbRes = await fetch(`${baseUrl}/api/thumb/${filename}`);
        if (thumbRes.status === 200 && thumbRes.headers.get('content-type') === 'image/webp') break;
        await new Promise((r) => setTimeout(r, 300));
      }
      assert.equal(thumbRes.status, 200, `Thumb not available: ${thumbRes.status}`);
      assert.equal(thumbRes.headers.get('content-type'), 'image/webp', 'Thumb should be webp');
    } finally { await deleteBreed(breed.id); }
  });

  await t.test('re-upload regenerates a different thumbnail', async () => {
    const breed = await createTestBreed();
    try {
      const r1 = await apiPost(`${baseUrl}/api/upload-image`,
        { name: breed.name, breedId: breed.id, dataUrl: RED_DATA_URL, context: 'master' },
        { Cookie: testAdminCk });
      assert.equal(r1.status, 200);
      const { path: p1 } = await r1.json();
      const filename = p1.split('?')[0].replace('/images/', '');
      // Wait for initial thumb
      let thumb1;
      for (let i = 0; i < 20; i++) {
        const res = await fetch(`${baseUrl}/api/thumb/${filename}`);
        if (res.status === 200 && res.headers.get('content-type') === 'image/webp') {
          thumb1 = Buffer.from(await res.arrayBuffer()); break;
        }
        await new Promise((r) => setTimeout(r, 300));
      }

      const r2 = await apiPost(`${baseUrl}/api/upload-image`,
        { name: breed.name, breedId: breed.id, dataUrl: BLUE_DATA_URL, context: 'master' },
        { Cookie: testAdminCk });
      assert.equal(r2.status, 200);
      const { path: p2 } = await r2.json();
      assert.ok(p2.includes('?t='), 'Second upload should return cache-buster');
      let thumb2;
      for (let i = 0; i < 20; i++) {
        const res = await fetch(`${baseUrl}/api/thumb/${filename}`);
        if (res.status === 200 && res.headers.get('content-type') === 'image/webp') {
          const buf = Buffer.from(await res.arrayBuffer());
          if (!buf.equals(thumb1)) { thumb2 = buf; break; }
        }
        await new Promise((r) => setTimeout(r, 300));
      }
      assert.ok(thumb2, 'Thumbnail should change after re-upload with different image');
    } finally { await deleteBreed(breed.id); }
  });

  // ── 2. ?t= stripping ───────────────────────────────────────────────────────
  await t.test('PATCH breed strips ?t= from imageUrl before saving', async () => {
    const breed = await createTestBreed();
    try {
      const upR = await apiPost(`${baseUrl}/api/upload-image`,
        { name: breed.name, breedId: breed.id, dataUrl: RED_DATA_URL, context: 'master' },
        { Cookie: testAdminCk });
      assert.equal(upR.status, 200);
      const { path: imgPath } = await upR.json();
      assert.ok(imgPath.includes('?t='));

      const patchR = await fetch(`${baseUrl}/api/breeds/${breed.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: testAdminCk },
        body: JSON.stringify({ imageUrl: imgPath }),
      });
      assert.equal(patchR.status, 200);
      const saved = await patchR.json();
      assert.ok(!saved.imageUrl.includes('?'), `Saved imageUrl should not contain ?t=, got: ${saved.imageUrl}`);
    } finally { await deleteBreed(breed.id); }
  });

  await t.test('PUT myherd strips ?t= from all imageUrls before saving', async () => {
    const { ck: userCk, id: userId } = await registerAndLoginUser(`testuser_${Date.now()}@test.invalid`);
    try {
      const fakeHerd = [{ id: 99901, name: 'MyBreed', imageUrl: '/images/99_mybreed_1.jpg?t=1234567890' }];
      const r = await fetch(`${baseUrl}/api/myherd`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: userCk },
        body: JSON.stringify(fakeHerd),
      });
      assert.equal(r.status, 200);
      const herd = await (await fetch(`${baseUrl}/api/myherd`, { headers: { Cookie: userCk } })).json();
      const saved = herd.find((b) => b.id === 99901);
      assert.ok(saved, 'breed should be in herd after PUT');
      assert.ok(!saved.imageUrl.includes('?'), `Saved imageUrl should not contain ?t=, got: ${saved.imageUrl}`);
    } finally {
      await deleteAccount(userId);
    }
  });

  // ── 3. Security ────────────────────────────────────────────────────────────
  await t.test('thumb returns 404 for unknown image', async () => {
    const r = await fetch(`${baseUrl}/api/thumb/nonexistent_file_xyz123.jpg`);
    assert.equal(r.status, 404);
  });

  await t.test('thumb blocks path traversal', async () => {
    const url = new URL(baseUrl);
    const status = await new Promise((resolve, reject) => {
      const req = http.request(
        { host: url.hostname, port: Number(url.port) || 80, path: '/api/thumb/../../etc/passwd', method: 'GET' },
        (res) => { resolve(res.statusCode); res.resume(); },
      );
      req.on('error', reject);
      req.end();
    });
    assert.ok([400, 404].includes(status), `Expected 400 or 404, got ${status}`);
  });

  await t.test('upload requires login', async () => {
    const r = await apiPost(`${baseUrl}/api/upload-image`,
      { name: nextName(), dataUrl: RED_DATA_URL, context: 'master' });
    assert.equal(r.status, 401);
  });

  // ── 4. External imageUrl flow ───────────────────────────────────────────────
  //
  // All three save paths must behave identically to the Add New Breed dialog:
  //   user pastes a http:// URL into the "Image URL" field
  //   -> server downloads the image, stores it locally, rewrites imageUrl
  //   -> result: local /images/ path, file served, thumbnail generated
  //
  // Test 10 (POST /api/breeds) is the REFERENCE — it mirrors Add New Breed.
  // Tests 11 (PATCH) and 12 (PUT) must produce the same outcome.

  await t.test('10 - POST /api/breeds (Add New Breed): external imageUrl is downloaded and saved locally', async () => {
    const breedName = nextName();
    const resp = await apiPost(`${baseUrl}/api/breeds`,
      { name: breedName, imageUrl: EXT_IMAGE_URL_A },
      { Cookie: testAdminCk });
    assert.equal(resp.status, 201, `POST /api/breeds returned ${resp.status}`);
    const breed = await resp.json();

    try {
      await assertExternalUrlFlow(breed.imageUrl, 'POST /api/breeds');

      // Verify the breeds list (grid) reflects the newly created breed with a local imageUrl
      const list = await (await fetch(`${baseUrl}/api/breeds`)).json();
      const inGrid = list.find((b) => b.id === breed.id);
      assert.ok(inGrid, `Breed id=${breed.id} should appear in GET /api/breeds`);
      assert.ok(
        inGrid.imageUrl?.startsWith('/images/'),
        `Grid entry imageUrl should be a local path, got: ${inGrid.imageUrl}`,
      );
    } finally {
      await deleteBreed(breed.id);
    }
  });

  await t.test('11 - PATCH /api/breeds/:id (Edit master list): replacing an existing image with a new external URL downloads the new image', async () => {
    const target = await createTestBreed();
    // seedB: a synthetically generated image served from localhost:5176 — guarantees
    // different bytes from test_cow.jpg so we can assert the file was actually replaced.
    const seedB = await createTestBreed();

    try {
      // ── Round 1: set initial image via real external URL A ────────────────
      const resp1 = await fetch(`${baseUrl}/api/breeds/${target.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: testAdminCk },
        body: JSON.stringify({ imageUrl: EXT_IMAGE_URL_A }),
      });
      assert.equal(resp1.status, 200, `Round-1 PATCH returned ${resp1.status}`);
      const breed1 = await resp1.json();
      await assertExternalUrlFlow(breed1.imageUrl, 'PATCH round 1');
      const content1 = Buffer.from(await (await fetch(`${baseUrl}${breed1.imageUrl}`)).arrayBuffer());

      // ── Round 2: update to URL B — different content, same dest filename ──
      const urlB = await seedExternalUrl(seedB.id, seedB.name);
      const resp2 = await fetch(`${baseUrl}/api/breeds/${target.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: testAdminCk },
        body: JSON.stringify({ imageUrl: urlB }),
      });
      assert.equal(resp2.status, 200, `Round-2 PATCH returned ${resp2.status}`);
      const breed2 = await resp2.json();
      await assertExternalUrlFlow(breed2.imageUrl, 'PATCH round 2');
      const content2 = Buffer.from(await (await fetch(`${baseUrl}${breed2.imageUrl}`)).arrayBuffer());

      assert.notDeepEqual(content1, content2, 'Image file must be replaced when a new external URL is set on an existing breed');

      // ── Grid state check ──────────────────────────────────────────────────
      const list = await (await fetch(`${baseUrl}/api/breeds`)).json();
      const inGrid = list.find((b) => b.id === target.id);
      assert.ok(inGrid, `Breed id=${target.id} should appear in GET /api/breeds`);
      assert.ok(inGrid.imageUrl?.startsWith('/images/'), `Grid entry imageUrl should be local, got: ${inGrid.imageUrl}`);
    } finally {
      await deleteBreed(target.id);
      await deleteBreed(seedB.id);
    }
  });

  await t.test('12 - PUT /api/myherd (Edit My Herd): replacing an existing image with a new external URL downloads the new image', async () => {
    const target = await createTestBreed();
    const seedB  = await createTestBreed();
    const { ck: userCk, id: userId } = await registerAndLoginUser(`testuser_${Date.now()}@test.invalid`);
    const herdEntry = { id: target.id, name: target.name };

    try {
      // ── Round 1: set initial image via real external URL A ────────────────
      const put1 = await fetch(`${baseUrl}/api/myherd`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: userCk },
        body: JSON.stringify([{ ...herdEntry, imageUrl: EXT_IMAGE_URL_A }]),
      });
      assert.equal(put1.status, 200, `Round-1 PUT returned ${put1.status}`);
      const herd1 = await (await fetch(`${baseUrl}/api/myherd`, { headers: { Cookie: userCk } })).json();
      const entry1 = herd1.find((b) => b.id === target.id);
      assert.ok(entry1, 'Breed should be in herd after round 1');
      await assertExternalUrlFlow(entry1.imageUrl, 'PUT myherd round 1');
      const content1 = Buffer.from(await (await fetch(`${baseUrl}${entry1.imageUrl}`)).arrayBuffer());

      // ── Round 2: update to URL B — different content, same dest filename ──
      const urlB = await seedExternalUrl(seedB.id, seedB.name);
      const put2 = await fetch(`${baseUrl}/api/myherd`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: userCk },
        body: JSON.stringify([{ ...herdEntry, imageUrl: urlB }]),
      });
      assert.equal(put2.status, 200, `Round-2 PUT returned ${put2.status}`);
      const herd2 = await (await fetch(`${baseUrl}/api/myherd`, { headers: { Cookie: userCk } })).json();
      const entry2 = herd2.find((b) => b.id === target.id);
      assert.ok(entry2, 'Breed should be in herd after round 2');
      await assertExternalUrlFlow(entry2.imageUrl, 'PUT myherd round 2');
      const content2 = Buffer.from(await (await fetch(`${baseUrl}${entry2.imageUrl}`)).arrayBuffer());

      assert.notDeepEqual(content1, content2, 'Image file must be replaced when a new external URL is set on an existing herd entry');
      assert.ok(entry2.imageUrl?.startsWith('/images/'), `Herd grid entry imageUrl should be local, got: ${entry2.imageUrl}`);
    } finally {
      await deleteBreed(target.id);
      await deleteBreed(seedB.id);
      await deleteAccount(userId);
    }
  });

  await t.test('PUT myherd with non-external imageUrl is passed through unchanged', async () => {
    const { ck: userCk, id: userId } = await registerAndLoginUser(`testuser_${Date.now()}@test.invalid`);
    try {
      const localPath = '/images/existing_local.jpg';

      await fetch(`${baseUrl}/api/myherd`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: userCk },
        body: JSON.stringify([{ id: 99902, name: 'LocalBreed', imageUrl: localPath }]),
      });

      const herd = await (await fetch(`${baseUrl}/api/myherd`, { headers: { Cookie: userCk } })).json();
      const entry = herd.find((b) => b.id === 99902);
      assert.ok(entry, 'Breed should be present');
      assert.equal(entry.imageUrl, localPath, 'Local /images/ paths should pass through unchanged');
    } finally {
      await deleteAccount(userId);
    }
  });

  // ── Teardown: delete the test admin account ────────────────────────────────
  {
    const delRes = await fetch(`${baseUrl}/api/accounts/${testAdminId}`, {
      method: 'DELETE',
      headers: { Cookie: seedCk },
    });
    assert.equal(delRes.status, 200, `Failed to delete test admin account: ${delRes.status}`);
  }
});

