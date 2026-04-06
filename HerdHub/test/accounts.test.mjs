/**
 * Account management & access-level tests
 *
 * Run with:
 *   TEST_BASE_URL=http://localhost:5176 node --test test/accounts.test.mjs
 *
 * Setup / teardown strategy
 * ─────────────────────────
 * A dedicated test-admin is created at the start of the run (via the seeded
 * production admin) and deleted at the end.  Every sub-test creates whatever
 * extra accounts it needs and deletes them in its own `finally` block.
 * No test pollutes the accounts DB across runs.
 *
 * Coverage
 * ────────
 * Auth
 *   1.  Register — happy path, auto-login, role=user
 *   2.  Register — duplicate email → 409
 *   3.  Register — short password → 400
 *   4.  Register — invalid email format → 400
 *   5.  Login — correct credentials → 200 + cookie
 *   6.  Login — wrong password → 401
 *   7.  Login — unknown email → 401
 *   8.  Login — missing fields → 400
 *   9.  Logout invalidates session
 *  10.  GET /api/me — guest (no cookie) → { role: 'guest' }
 *  11.  GET /api/me — logged-in user → email + role
 *
 * Access controls — guest restrictions
 *  12.  Guest cannot GET /api/myherd
 *  13.  Guest cannot PUT /api/myherd
 *  14.  Guest cannot POST /api/upload-image
 *  15.  Guest cannot GET /api/accounts
 *  16.  Guest can GET /api/breeds (public)
 *
 * Access controls — user restrictions (logged-in, role=user)
 *  17.  User can GET /api/myherd
 *  18.  User can PUT /api/myherd
 *  19.  User can POST /api/upload-image (own images)
 *  20.  User cannot GET /api/accounts → 403
 *  21.  User cannot POST /api/breeds → 403
 *  22.  User cannot PATCH /api/breeds/:id → 403
 *  23.  User cannot DELETE /api/breeds/:id → 403
 *  24.  User cannot POST /api/accounts → 403
 *  25.  User cannot PATCH /api/accounts/:id → 403
 *  26.  User cannot DELETE /api/accounts/:id → 403
 *  27.  User cannot impersonate → 403
 *
 * Access controls — admin capabilities
 *  28.  Admin can GET /api/accounts (no passwordHash exposed)
 *  29.  Admin can POST /api/accounts (create user)
 *  30.  Admin can POST /api/accounts (create admin)
 *  31.  Admin cannot create account with invalid role → 400
 *  32.  Admin can PATCH /api/accounts/:id — change role
 *  33.  Admin can PATCH /api/accounts/:id — change password
 *  34.  Admin PATCH — short password → 400
 *  35.  Admin PATCH — unknown id → 404
 *  36.  Admin can DELETE /api/accounts/:id
 *  37.  Admin DELETE — unknown id → 404
 *  38.  Admin can POST /api/breeds
 *  39.  Admin can PATCH /api/breeds/:id
 *  40.  Admin can DELETE /api/breeds/:id
 *
 * Impersonation
 *  41.  Admin can impersonate a user → session acts as that user
 *  42.  Admin cannot impersonate while already impersonating → 400
 *  43.  After unimpersonate: session returns to admin
 *  44.  Non-admin cannot POST /api/impersonate → 403
 *  45.  Un-impersonate without active impersonation → 400
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";

// ── Globals ───────────────────────────────────────────────────────────────────
const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:5176";
const RUN_ID = Date.now();

// The real seed admin used only to bootstrap our test-admin
const SEED_ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@herdhub.com";
const SEED_ADMIN_PASSWORD =
  process.env.SEED_ADMIN_PASSWORD ??
  (() => {
    throw new Error("Set SEED_ADMIN_PASSWORD env var");
  })();

// Test admin — created fresh each run
let tAdminEmail;
let tAdminPassword;
let tAdminId;
let tAdminCk; // valid session cookie for test admin

// ── HTTP helpers ──────────────────────────────────────────────────────────────
async function post(path, body, cookie) {
  return fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function get(path, cookie) {
  return fetch(`${BASE_URL}${path}`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
}

async function patch(path, body, cookie) {
  return fetch(`${BASE_URL}${path}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function del(path, cookie) {
  return fetch(`${BASE_URL}${path}`, {
    method: "DELETE",
    headers: cookie ? { Cookie: cookie } : {},
  });
}

async function put(path, body, cookie) {
  return fetch(`${BASE_URL}${path}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

/** Login and return the session cookie string. Throws on failure. */
async function login(email, password) {
  const r = await post("/api/login", { email, password });
  const body = await r.json();
  assert.equal(
    r.status,
    200,
    `Login failed for ${email}: ${JSON.stringify(body)}`,
  );
  return r.headers.get("set-cookie").split(";")[0];
}

/** Register and return the session cookie. Idempotent (ignores 409). */
async function register(email, password = "TestPass1!") {
  await post("/api/register", { email, password }).catch(() => {});
  return login(email, password);
}

/** Register without logging in; returns { status, body }. */
async function rawRegister(email, password) {
  const r = await post("/api/register", { email, password });
  return { status: r.status, body: await r.json() };
}

/** Create an account via the admin API, return its id. */
async function adminCreateAccount(email, password, role = "user") {
  const r = await post("/api/accounts", { email, password, role }, tAdminCk);
  assert.equal(r.status, 201, `adminCreateAccount failed: ${r.status}`);
  const body = await r.json();
  return body.id;
}

/** Delete an account via the admin API (best-effort, for cleanup). */
async function adminDeleteAccount(id) {
  await del(`/api/accounts/${id}`, tAdminCk);
}

/** Create a breed via the admin API, return its id. */
async function adminCreateBreed(name) {
  const r = await post("/api/breeds", { name }, tAdminCk);
  assert.equal(r.status, 201);
  const body = await r.json();
  return body.id;
}

/** Delete a breed via the admin API (best-effort, for cleanup). */
async function adminDeleteBreed(id) {
  await del(`/api/breeds/${id}`, tAdminCk);
}

// Unique email helper
let emailIdx = 0;
function email(prefix = "test") {
  return `${prefix}_${RUN_ID}_${++emailIdx}@test.invalid`;
}

// ── Suite setup / teardown ────────────────────────────────────────────────────
before(async () => {
  tAdminEmail = `testadmin_${RUN_ID}@test.invalid`;
  tAdminPassword = `TestAdmin${RUN_ID}!`;

  // Use the seeded (real) admin to bootstrap a temporary test-admin
  const seedCk = await login(SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD);

  const r = await post(
    "/api/accounts",
    { email: tAdminEmail, password: tAdminPassword, role: "admin" },
    seedCk,
  );
  const created = await r.json();
  assert.equal(
    r.status,
    201,
    `Failed to create test admin: ${r.status} ${JSON.stringify(created)}`,
  );

  tAdminId = created.id;
  tAdminCk = await login(tAdminEmail, tAdminPassword);
  assert.ok(tAdminId, "Could not retrieve test admin id");
});

after(async () => {
  if (tAdminId) {
    // Use the seed admin to delete our test admin
    const seedCk = await login(SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD);
    await del(`/api/accounts/${tAdminId}`, seedCk);
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// 1–11  AUTH
// ═════════════════════════════════════════════════════════════════════════════

test("1 - register happy path: 201, auto-login, role=user", async () => {
  const em = email("reg");
  let id;
  try {
    const r = await post("/api/register", {
      email: em,
      password: "TestPass1!",
    });
    const body = await r.json();
    assert.equal(r.status, 201);
    assert.equal(body.email, em);
    assert.equal(body.role, "user");
    assert.ok(!body.passwordHash, "passwordHash must not be exposed");
    assert.ok(r.headers.get("set-cookie"), "should set a session cookie");
    // confirm the account exists
    const accs = await (await get("/api/accounts", tAdminCk)).json();
    id = accs.find((a) => a.email === em)?.id;
    assert.ok(id, "Account should appear in admin list");
  } finally {
    if (id) await adminDeleteAccount(id);
    else {
      const accs = await (await get("/api/accounts", tAdminCk)).json();
      const found = accs.find((a) => a.email === em);
      if (found) await adminDeleteAccount(found.id);
    }
  }
});

test("2 - register duplicate email → 409", async () => {
  const em = email("dup");
  let id;
  try {
    const accs0 = await (await get("/api/accounts", tAdminCk)).json();
    const r1 = await post("/api/register", {
      email: em,
      password: "TestPass1!",
    });
    assert.equal(r1.status, 201);
    const r2 = await post("/api/register", {
      email: em,
      password: "TestPass1!",
    });
    assert.equal(r2.status, 409);
    const body = await r2.json();
    assert.ok(body.error, "should return error message");
    const accs = await (await get("/api/accounts", tAdminCk)).json();
    id = accs.find((a) => a.email === em)?.id;
  } finally {
    if (id) await adminDeleteAccount(id);
  }
});

test("3 - register short password → 400", async () => {
  const { status, body } = await rawRegister(email("short"), "abc");
  assert.equal(status, 400);
  assert.ok(body.error);
});

test("4 - register invalid email format → 400", async () => {
  try {
    const { status, body } = await rawRegister("not-an-email", "TestPass1!");
    assert.equal(
      status,
      400,
      `Expected 400 but server accepted malformed email: ${JSON.stringify(body)}`,
    );
    assert.ok(body.error);
  } finally {
    // cleanup in case a server without email validation accidentally created this account
    const accs = await (await get("/api/accounts", tAdminCk)).json();
    const leaked = accs.find((a) => a.email === "not-an-email");
    if (leaked) await adminDeleteAccount(leaked.id);
  }
});

test("5 - login correct credentials → 200 + cookie", async () => {
  const em = email("login_ok");
  let id;
  try {
    const rReg = await post("/api/register", {
      email: em,
      password: "TestPass1!",
    });
    assert.equal(rReg.status, 201);
    const accs = await (await get("/api/accounts", tAdminCk)).json();
    id = accs.find((a) => a.email === em)?.id;

    const r = await post("/api/login", { email: em, password: "TestPass1!" });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.email, em);
    assert.ok(r.headers.get("set-cookie"), "should set a session cookie");
  } finally {
    if (id) await adminDeleteAccount(id);
  }
});

test("6 - login wrong password → 401", async () => {
  const em = email("login_bad_pw");
  let id;
  try {
    await post("/api/register", { email: em, password: "TestPass1!" });
    const accs = await (await get("/api/accounts", tAdminCk)).json();
    id = accs.find((a) => a.email === em)?.id;
    const r = await post("/api/login", { email: em, password: "WrongPass!" });
    assert.equal(r.status, 401);
  } finally {
    if (id) await adminDeleteAccount(id);
  }
});

test("7 - login unknown email → 401", async () => {
  const r = await post("/api/login", {
    email: "nobody@test.invalid",
    password: "TestPass1!",
  });
  assert.equal(r.status, 401);
});

test("8 - login missing fields → 400", async () => {
  const r1 = await post("/api/login", { email: "x@test.invalid" });
  assert.equal(r1.status, 400);
  const r2 = await post("/api/login", { password: "TestPass1!" });
  assert.equal(r2.status, 400);
});

test("9 - logout invalidates session", async () => {
  const em = email("logout");
  let id;
  try {
    const ck = await register(em);
    const accs = await (await get("/api/accounts", tAdminCk)).json();
    id = accs.find((a) => a.email === em)?.id;

    // confirm session works before logout
    const me1 = await (await get("/api/me", ck)).json();
    assert.equal(me1.email, em);

    // logout
    const rLogout = await post("/api/logout", {}, ck);
    assert.equal(rLogout.status, 200);

    // same cookie should now be guest
    const me2 = await (await get("/api/me", ck)).json();
    assert.equal(me2.role, "guest");
  } finally {
    if (id) await adminDeleteAccount(id);
  }
});

test("10 - GET /api/me without cookie → guest", async () => {
  const r = await get("/api/me");
  const body = await r.json();
  assert.equal(r.status, 200);
  assert.equal(body.role, "guest");
  assert.ok(!body.email, "guest should not expose email");
});

test("11 - GET /api/me with valid session → email + role", async () => {
  const em = email("me");
  let id;
  try {
    const ck = await register(em);
    const accs = await (await get("/api/accounts", tAdminCk)).json();
    id = accs.find((a) => a.email === em)?.id;
    const body = await (await get("/api/me", ck)).json();
    assert.equal(body.email, em);
    assert.equal(body.role, "user");
  } finally {
    if (id) await adminDeleteAccount(id);
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// 12–16  GUEST ACCESS CONTROLS
// ═════════════════════════════════════════════════════════════════════════════

test("12 - guest cannot GET /api/myherd → 401", async () => {
  const r = await get("/api/myherd");
  assert.equal(r.status, 401);
});

test("13 - guest cannot PUT /api/myherd → 401", async () => {
  const r = await put("/api/myherd", []);
  assert.equal(r.status, 401);
});

test("14 - guest cannot POST /api/upload-image → 401", async () => {
  const r = await post("/api/upload-image", {
    name: "x",
    breedId: 1,
    dataUrl: "data:image/jpeg;base64,AA==",
    context: "master",
  });
  assert.equal(r.status, 401);
});

test("15 - guest cannot GET /api/accounts → 403", async () => {
  const r = await get("/api/accounts");
  assert.equal(r.status, 403);
});

test("16 - guest can GET /api/breeds (public)", async () => {
  const r = await get("/api/breeds");
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(Array.isArray(body));
});

// ═════════════════════════════════════════════════════════════════════════════
// 17–27  USER ACCESS CONTROLS
// ═════════════════════════════════════════════════════════════════════════════

test("17 - user can GET /api/myherd", async () => {
  const em = email("user_myherd_get");
  let id;
  try {
    const ck = await register(em);
    const accs = await (await get("/api/accounts", tAdminCk)).json();
    id = accs.find((a) => a.email === em)?.id;
    const r = await get("/api/myherd", ck);
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.ok(Array.isArray(body));
  } finally {
    if (id) await adminDeleteAccount(id);
  }
});

test("18 - user can PUT /api/myherd", async () => {
  const em = email("user_myherd_put");
  let id;
  try {
    const ck = await register(em);
    const accs = await (await get("/api/accounts", tAdminCk)).json();
    id = accs.find((a) => a.email === em)?.id;
    const r = await put(
      "/api/myherd",
      [{ id: 999, name: "TestEntry", tags: [], imageUrl: null }],
      ck,
    );
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.ok(body.ok);
    // verify it was actually saved
    const herd = await (await get("/api/myherd", ck)).json();
    assert.equal(herd.length, 1);
    assert.equal(herd[0].name, "TestEntry");
  } finally {
    if (id) await adminDeleteAccount(id);
  }
});

test("19 - user can POST /api/upload-image (own images)", async () => {
  const em = email("user_upload");
  let id, breedId;
  try {
    const ck = await register(em);
    const accs = await (await get("/api/accounts", tAdminCk)).json();
    id = accs.find((a) => a.email === em)?.id;
    breedId = await adminCreateBreed(`UploadTest_${RUN_ID}`);
    // Generate a real JPEG using sharp (same approach as image-upload.test.mjs)
    const { default: sharp } = await import("sharp");
    const jpegBuf = await sharp({
      create: {
        width: 4,
        height: 4,
        channels: 3,
        background: { r: 255, g: 0, b: 0 },
      },
    })
      .jpeg()
      .toBuffer();
    const dataUrl = `data:image/jpeg;base64,${jpegBuf.toString("base64")}`;
    const r = await post(
      "/api/upload-image",
      { name: "UploadTest", breedId, dataUrl, context: "user" },
      ck,
    );
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.ok(
      body.path?.startsWith("/images/"),
      `expected /images/ path, got: ${body.path}`,
    );
  } finally {
    if (breedId) await adminDeleteBreed(breedId);
    if (id) await adminDeleteAccount(id);
  }
});

test("20 - user cannot GET /api/accounts → 403", async () => {
  const em = email("user_no_accs");
  let id;
  try {
    const ck = await register(em);
    const accs = await (await get("/api/accounts", tAdminCk)).json();
    id = accs.find((a) => a.email === em)?.id;
    const r = await get("/api/accounts", ck);
    assert.equal(r.status, 403);
  } finally {
    if (id) await adminDeleteAccount(id);
  }
});

test("21 - user cannot POST /api/breeds → 403", async () => {
  const em = email("user_no_breed_post");
  let id;
  try {
    const ck = await register(em);
    const accs = await (await get("/api/accounts", tAdminCk)).json();
    id = accs.find((a) => a.email === em)?.id;
    const r = await post("/api/breeds", { name: "Hacked" }, ck);
    assert.equal(r.status, 403);
  } finally {
    if (id) await adminDeleteAccount(id);
  }
});

test("22 - user cannot PATCH /api/breeds/:id → 403", async () => {
  const em = email("user_no_breed_patch");
  let id, breedId;
  try {
    const ck = await register(em);
    const accs = await (await get("/api/accounts", tAdminCk)).json();
    id = accs.find((a) => a.email === em)?.id;
    breedId = await adminCreateBreed(`PatchBlock_${RUN_ID}`);
    const r = await patch(`/api/breeds/${breedId}`, { name: "Hacked" }, ck);
    assert.equal(r.status, 403);
  } finally {
    if (breedId) await adminDeleteBreed(breedId);
    if (id) await adminDeleteAccount(id);
  }
});

test("23 - user cannot DELETE /api/breeds/:id → 403", async () => {
  const em = email("user_no_breed_del");
  let id, breedId;
  try {
    const ck = await register(em);
    const accs = await (await get("/api/accounts", tAdminCk)).json();
    id = accs.find((a) => a.email === em)?.id;
    breedId = await adminCreateBreed(`DeleteBlock_${RUN_ID}`);
    const r = await del(`/api/breeds/${breedId}`, ck);
    assert.equal(r.status, 403);
    // confirm breed still exists
    const breeds = await (await get("/api/breeds")).json();
    assert.ok(
      breeds.some((b) => b.id === breedId),
      "breed should still exist after blocked delete",
    );
  } finally {
    if (breedId) await adminDeleteBreed(breedId);
    if (id) await adminDeleteAccount(id);
  }
});

test("24 - user cannot POST /api/accounts → 403", async () => {
  const em = email("user_no_acc_create");
  let id;
  try {
    const ck = await register(em);
    const accs = await (await get("/api/accounts", tAdminCk)).json();
    id = accs.find((a) => a.email === em)?.id;
    const r = await post(
      "/api/accounts",
      { email: email("injected"), password: "TestPass1!", role: "admin" },
      ck,
    );
    assert.equal(r.status, 403);
  } finally {
    if (id) await adminDeleteAccount(id);
  }
});

test("25 - user cannot PATCH /api/accounts/:id → 403", async () => {
  const em = email("user_no_acc_patch");
  let id, victimId;
  try {
    const ck = await register(em);
    const accs = await (await get("/api/accounts", tAdminCk)).json();
    id = accs.find((a) => a.email === em)?.id;
    const victimEmail = email("victim");
    victimId = await adminCreateAccount(victimEmail, "TestPass1!");
    const r = await patch(`/api/accounts/${victimId}`, { role: "admin" }, ck);
    assert.equal(r.status, 403);
    // confirm role was not changed
    const accs2 = await (await get("/api/accounts", tAdminCk)).json();
    const victim = accs2.find((a) => a.id === victimId);
    assert.equal(victim?.role, "user", "role must not have been escalated");
  } finally {
    if (victimId) await adminDeleteAccount(victimId);
    if (id) await adminDeleteAccount(id);
  }
});

test("26 - user cannot DELETE /api/accounts/:id → 403", async () => {
  const em = email("user_no_acc_del");
  let id, victimId;
  try {
    const ck = await register(em);
    const accs = await (await get("/api/accounts", tAdminCk)).json();
    id = accs.find((a) => a.email === em)?.id;
    const victimEmail = email("victim2");
    victimId = await adminCreateAccount(victimEmail, "TestPass1!");
    const r = await del(`/api/accounts/${victimId}`, ck);
    assert.equal(r.status, 403);
    // confirm account still exists
    const accs2 = await (await get("/api/accounts", tAdminCk)).json();
    assert.ok(
      accs2.some((a) => a.id === victimId),
      "victim account should still exist",
    );
  } finally {
    if (victimId) await adminDeleteAccount(victimId);
    if (id) await adminDeleteAccount(id);
  }
});

test("27 - user cannot POST /api/impersonate → 403", async () => {
  const em = email("user_no_impersonate");
  let id, targetId;
  try {
    const ck = await register(em);
    const accs = await (await get("/api/accounts", tAdminCk)).json();
    id = accs.find((a) => a.email === em)?.id;
    targetId = await adminCreateAccount(email("target"), "TestPass1!");
    const r = await post(`/api/impersonate/${targetId}`, {}, ck);
    assert.equal(r.status, 403);
  } finally {
    if (targetId) await adminDeleteAccount(targetId);
    if (id) await adminDeleteAccount(id);
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// 28–40  ADMIN ACCOUNT MANAGEMENT
// ═════════════════════════════════════════════════════════════════════════════

test("28 - admin GET /api/accounts: list without passwordHash", async () => {
  const r = await get("/api/accounts", tAdminCk);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(Array.isArray(body));
  for (const acc of body) {
    assert.ok(
      !("passwordHash" in acc),
      `passwordHash must not be exposed on ${acc.email}`,
    );
    assert.ok("id" in acc);
    assert.ok("email" in acc);
    assert.ok("role" in acc);
  }
});

test("29 - admin POST /api/accounts creates user account", async () => {
  const em = email("admin_create_user");
  let id;
  try {
    const r = await post(
      "/api/accounts",
      { email: em, password: "TestPass1!", role: "user" },
      tAdminCk,
    );
    assert.equal(r.status, 201);
    const body = await r.json();
    assert.equal(body.email, em);
    assert.equal(body.role, "user");
    assert.ok(!body.passwordHash);
    id = body.id;
    // verify login works
    const ck = await login(em, "TestPass1!");
    const me = await (await get("/api/me", ck)).json();
    assert.equal(me.role, "user");
  } finally {
    if (id) await adminDeleteAccount(id);
  }
});

test("30 - admin POST /api/accounts creates admin account", async () => {
  const em = email("admin_create_admin");
  let id;
  try {
    const r = await post(
      "/api/accounts",
      { email: em, password: "TestPass1!", role: "admin" },
      tAdminCk,
    );
    assert.equal(r.status, 201);
    const body = await r.json();
    assert.equal(body.role, "admin");
    id = body.id;
    // verify new admin can access accounts list
    const newAdminCk = await login(em, "TestPass1!");
    const accs = await get("/api/accounts", newAdminCk);
    assert.equal(accs.status, 200);
  } finally {
    if (id) await adminDeleteAccount(id);
  }
});

test("31 - admin cannot create account with invalid role → 400", async () => {
  const r = await post(
    "/api/accounts",
    { email: email("bad_role"), password: "TestPass1!", role: "superuser" },
    tAdminCk,
  );
  assert.equal(r.status, 400);
  const body = await r.json();
  assert.ok(body.error);
});

test("32 - admin PATCH /api/accounts/:id changes role", async () => {
  const em = email("role_change");
  let id;
  try {
    id = await adminCreateAccount(em, "TestPass1!", "user");
    const r = await patch(`/api/accounts/${id}`, { role: "admin" }, tAdminCk);
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.role, "admin");
    // verify the role change is persisted
    const accs = await (await get("/api/accounts", tAdminCk)).json();
    assert.equal(accs.find((a) => a.id === id)?.role, "admin");
  } finally {
    if (id) await adminDeleteAccount(id);
  }
});

test("33 - admin PATCH /api/accounts/:id changes password", async () => {
  const em = email("pw_change");
  let id;
  try {
    id = await adminCreateAccount(em, "OldPass1!");
    const r = await patch(
      `/api/accounts/${id}`,
      { password: "NewPass2!" },
      tAdminCk,
    );
    assert.equal(r.status, 200);
    // old password should no longer work
    const bad = await post("/api/login", { email: em, password: "OldPass1!" });
    assert.equal(bad.status, 401);
    // new password should work
    const good = await post("/api/login", { email: em, password: "NewPass2!" });
    assert.equal(good.status, 200);
  } finally {
    if (id) await adminDeleteAccount(id);
  }
});

test("34 - admin PATCH short password → 400", async () => {
  const em = email("pw_short");
  let id;
  try {
    id = await adminCreateAccount(em, "TestPass1!");
    const r = await patch(
      `/api/accounts/${id}`,
      { password: "short" },
      tAdminCk,
    );
    assert.equal(r.status, 400);
  } finally {
    if (id) await adminDeleteAccount(id);
  }
});

test("35 - admin PATCH unknown id → 404", async () => {
  const r = await patch("/api/accounts/00000000", { role: "user" }, tAdminCk);
  assert.equal(r.status, 404);
});

test("36 - admin DELETE /api/accounts/:id removes account", async () => {
  const em = email("delete_me");
  const id = await adminCreateAccount(em, "TestPass1!");
  const r = await del(`/api/accounts/${id}`, tAdminCk);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(body.ok);
  // verify account is gone
  const accs = await (await get("/api/accounts", tAdminCk)).json();
  assert.ok(
    !accs.some((a) => a.id === id),
    "deleted account must not appear in list",
  );
  // login should fail
  const loginRes = await post("/api/login", {
    email: em,
    password: "TestPass1!",
  });
  assert.equal(loginRes.status, 401);
});

test("37 - admin DELETE unknown id → 404", async () => {
  const r = await del("/api/accounts/00000000", tAdminCk);
  assert.equal(r.status, 404);
});

test("38 - admin can POST /api/breeds", async () => {
  const name = `AdminBreed_${RUN_ID}`;
  let id;
  try {
    const r = await post("/api/breeds", { name }, tAdminCk);
    assert.equal(r.status, 201);
    const body = await r.json();
    assert.equal(body.name, name);
    id = body.id;
    const breeds = await (await get("/api/breeds")).json();
    assert.ok(breeds.some((b) => b.id === id));
  } finally {
    if (id) await adminDeleteBreed(id);
  }
});

test("39 - admin can PATCH /api/breeds/:id", async () => {
  let id;
  try {
    id = await adminCreateBreed(`PatchTarget_${RUN_ID}`);
    const r = await patch(
      `/api/breeds/${id}`,
      { origin: "TestOrigin" },
      tAdminCk,
    );
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.origin, "TestOrigin");
    // verify persistence
    const breeds = await (await get("/api/breeds")).json();
    assert.equal(breeds.find((b) => b.id === id)?.origin, "TestOrigin");
  } finally {
    if (id) await adminDeleteBreed(id);
  }
});

test("40 - admin can DELETE /api/breeds/:id", async () => {
  const id = await adminCreateBreed(`DeleteTarget_${RUN_ID}`);
  const r = await del(`/api/breeds/${id}`, tAdminCk);
  assert.equal(r.status, 200);
  const breeds = await (await get("/api/breeds")).json();
  assert.ok(
    !breeds.some((b) => b.id === id),
    "breed should be gone after admin delete",
  );
});

// ═════════════════════════════════════════════════════════════════════════════
// 41–45  IMPERSONATION
// ═════════════════════════════════════════════════════════════════════════════

test("41 - admin can impersonate a user, session acts as that user", async () => {
  const em = email("impersonatee");
  let userId, impCk;
  try {
    userId = await adminCreateAccount(em, "TestPass1!", "user");

    const r = await post(`/api/impersonate/${userId}`, {}, tAdminCk);
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.email, em);
    assert.equal(body.impersonating, true);
    impCk = r.headers.get("set-cookie").split(";")[0];

    // The impersonated session should report as the target user
    const me = await (await get("/api/me", impCk)).json();
    assert.equal(me.email, em);
    assert.equal(me.impersonating, true);

    // Impersonated session has user role (cannot access admin endpoints)
    const accsRes = await get("/api/accounts", impCk);
    assert.equal(
      accsRes.status,
      403,
      "impersonated user session must not access admin routes",
    );
  } finally {
    // Unimpersonate before cleanup so tAdminCk is still valid
    if (impCk) {
      await post("/api/unimpersonate", {}, impCk);
    }
    if (userId) await adminDeleteAccount(userId);
  }
});

test("42 - admin cannot start a second impersonation while already impersonating → 400", async () => {
  // Use a freshly-created temp admin so we never mutate the shared tAdminCk session.
  // Impersonate an admin target (not a user) so the session keeps role='admin'
  // and can reach requireAdmin → then hits the adminBackup guard → 400.
  const tempAdminEmail = email("temp_admin_42");
  const adminTargetEmail = email("imp_42_admin_target");
  const userTargetEmail = email("imp_42_user_target");
  let tempAdminId, adminTargetId, userTargetId;
  let tempAdminCk;
  try {
    tempAdminId = await adminCreateAccount(
      tempAdminEmail,
      "TestPass1!",
      "admin",
    );
    adminTargetId = await adminCreateAccount(
      adminTargetEmail,
      "TestPass1!",
      "admin",
    );
    userTargetId = await adminCreateAccount(
      userTargetEmail,
      "TestPass1!",
      "user",
    );
    tempAdminCk = await login(tempAdminEmail, "TestPass1!");

    // First impersonation: temp admin → admin target (session stays admin-role)
    const r1 = await post(`/api/impersonate/${adminTargetId}`, {}, tempAdminCk);
    assert.equal(r1.status, 200, `First impersonation failed: ${r1.status}`);

    // Second impersonation with same session: adminBackup already set → 400
    const r2 = await post(`/api/impersonate/${userTargetId}`, {}, tempAdminCk);
    assert.equal(
      r2.status,
      400,
      `Expected 400 (already impersonating), got ${r2.status}`,
    );
    const body = await r2.json();
    assert.ok(body.error);
  } finally {
    await post("/api/unimpersonate", {}, tempAdminCk).catch(() => {});
    if (userTargetId) await adminDeleteAccount(userTargetId);
    if (adminTargetId) await adminDeleteAccount(adminTargetId);
    if (tempAdminId) await adminDeleteAccount(tempAdminId);
  }
});

test("43 - unimpersonate restores admin session", async () => {
  const em = email("imp_restore");
  let userId, impCk;
  try {
    userId = await adminCreateAccount(em, "TestPass1!", "user");

    const rImp = await post(`/api/impersonate/${userId}`, {}, tAdminCk);
    assert.equal(rImp.status, 200);
    impCk = rImp.headers.get("set-cookie").split(";")[0];

    const rUnimp = await post("/api/unimpersonate", {}, impCk);
    assert.equal(rUnimp.status, 200);
    const body = await rUnimp.json();
    assert.equal(body.role, "admin");

    // session should now have admin access again
    const accs = await get("/api/accounts", impCk);
    assert.equal(accs.status, 200);

    // me should no longer be impersonating
    const me = await (await get("/api/me", impCk)).json();
    assert.equal(me.impersonating, false);
  } finally {
    if (userId) await adminDeleteAccount(userId);
  }
});

test("44 - non-admin cannot POST /api/impersonate → 403", async () => {
  const em = email("user_impersonate_blocked");
  let id, targetId;
  try {
    const ck = await register(em);
    const accs = await (await get("/api/accounts", tAdminCk)).json();
    id = accs.find((a) => a.email === em)?.id;
    targetId = await adminCreateAccount(
      email("imp_target_nonadmin"),
      "TestPass1!",
      "user",
    );
    const r = await post(`/api/impersonate/${targetId}`, {}, ck);
    assert.equal(r.status, 403);
  } finally {
    if (targetId) await adminDeleteAccount(targetId);
    if (id) await adminDeleteAccount(id);
  }
});

test("45 - unimpersonate without active impersonation → 400", async () => {
  // tAdminCk is a plain admin session (no impersonation active)
  const r = await post("/api/unimpersonate", {}, tAdminCk);
  assert.equal(r.status, 400);
  const body = await r.json();
  assert.ok(body.error);
});

test("46 - admin can GET /api/admin/backup → 200 + tar.gz stream", async () => {
  const r = await get("/api/admin/backup", tAdminCk);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "application/gzip");
  assert.ok(r.headers.get("content-disposition")?.includes("attachment"));

  // Read only first chunk to verify stream works without downloading entire backup
  const reader = r.body.getReader();
  const result = await reader.read();
  reader.releaseLock();

  assert.ok(!result.done, "Stream should not be done immediately");
  assert.ok(
    result.value && result.value.length > 0,
    "Backup stream should have data",
  );
});
