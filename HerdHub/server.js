// Express server — HerdHub API + serves the built React frontend
import express from "express";
import { writeFile, mkdir, readFile, readdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import session from "express-session";
import bcrypt from "bcryptjs";
import sharp from "sharp";
import archiver from "archiver";
import unzipper from "unzipper";
import compression from "compression";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { getDb, closeDb } from "./db/index.js";

// Add unhandled error handlers
process.on("uncaughtException", (error) => {
  const prefix = process.env.NODE_ENV === "test" ? "⚠️" : "❌";
  console.error(`${prefix} Uncaught Exception:`, error.message);
  console.error("Stack trace:", error.stack);
  // Don't exit, keep server running
});

process.on("unhandledRejection", (reason, promise) => {
  const prefix = process.env.NODE_ENV === "test" ? "⚠️" : "❌";
  console.error(`${prefix} Unhandled Rejection at:`, promise);
  console.error("Reason:", reason);
  // Don't exit, keep server running
});

// Initialize SQLite Database (auto-migrates if needed)
getDb();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const IMG_DIR = path.join(DATA_DIR, "images");
const THUMB_DIR = path.join(IMG_DIR, "thumbs");
const DIST_DIR = path.join(__dirname, "dist");
const DB_DIR = path.join(DATA_DIR, "db");
const BREEDS_DB = path.join(DB_DIR, "breeds.json");
const ACCOUNTS_DB = path.join(DB_DIR, "accounts.json");
const USERS_DIR = path.join(DB_DIR, "users");
const BREEDS_BUNDLED = path.join(__dirname, "public", "breeds.json");
const PORT = process.env.PORT || 5176;

// ── DB helpers ────────────────────────────────────────────────────────────────
/** Capitalize first letter, lowercase rest. Deduplicates case-insensitively. */
function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  const seen = new Map();
  for (const t of tags) {
    if (!t) continue;
    const norm =
      t.trim().charAt(0).toUpperCase() + t.trim().slice(1).toLowerCase();
    // Keep first occurrence wins on case conflict
    const key = norm.toLowerCase();
    if (!seen.has(key)) seen.set(key, norm);
  }
  return [...seen.values()];
}

/** Parse props JSON and add tags field for frontend compatibility */
function parseBreedProps(breed) {
  let tags = [];
  if (breed.props) {
    try {
      const props = JSON.parse(breed.props);
      tags = props.tags || [];
    } catch (e) {
      // If props is not valid JSON, leave tags empty
    }
  }
  // Strip internal SQLite fields that should not be exposed to the frontend
  const { props, species, ...rest } = breed;
  return { ...rest, tags };
}
async function loadDb(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

async function saveDb(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 2));

  // Dual-write to SQLite (keeps DB in sync with JSON during test/dev runs)
  try {
    const db = getDb();
    db.pragma("foreign_keys = OFF"); // Avoid ordering issues during JSON saves
    if (file.endsWith("accounts.json")) {
      const stmt = db.prepare(
        "INSERT OR REPLACE INTO accounts (id, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)",
      );
      const runMany = db.transaction((rows) =>
        rows.forEach((r) =>
          stmt.run(r.id, r.email, r.passwordHash, r.role, r.createdAt),
        ),
      );
      runMany(data);
    } else if (file.endsWith("breeds.json")) {
      const stmt = db.prepare(
        "INSERT OR REPLACE INTO breeds (id, species, name, origin, subspecies, image_url, wiki_url, props, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      );
      const runMany = db.transaction((rows) =>
        rows.forEach((r) =>
          stmt.run(
            r.id,
            "cattle",
            r.name,
            r.origin,
            r.subspecies,
            r.imageUrl,
            r.wikiUrl,
            JSON.stringify({ tags: r.tags, purpose: r.purpose }),
            new Date().toISOString(),
            new Date().toISOString(),
          ),
        ),
      );
      runMany(data);
    } else if (file.endsWith("myherd.json")) {
      const parts = file.split(path.sep);
      const b64email = parts[parts.length - 2];
      const email = Buffer.from(b64email, "base64url").toString("utf8");
      const user = db
        .prepare("SELECT id FROM accounts WHERE email = ?")
        .get(email);
      if (user) {
        const stmt = db.prepare(
          "INSERT OR REPLACE INTO user_herds (user_id, breed_id, custom_name, custom_image_url, custom_notes, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        );
        const runMany = db.transaction((rows) =>
          rows.forEach((r) =>
            stmt.run(
              user.id,
              r.id,
              r.name || null,
              r.imageUrl || null,
              r.notes || null,
              new Date().toISOString(),
            ),
          ),
        );
        runMany(data);
      }
    }
    db.pragma("foreign_keys = ON");
  } catch (err) {
    // Log dual-write errors in development/test
    if (process.env.NODE_ENV !== "production") {
      console.warn("⚠️ Dual-write to SQLite failed:", err.message);
    }
    // JSON remains authoritative during migration
  }
}

function userMyherdFile(email) {
  // Use base64 of email as directory name to avoid filesystem issues
  const safe = Buffer.from(email).toString("base64url");
  return path.join(USERS_DIR, safe, "myherd.json");
}

function sessionUser(req) {
  return req.session?.user ?? null;
}

/** Reject URLs targeting private/loopback/metadata addresses in production (SSRF protection). */
function assertNoSsrf(rawUrl) {
  if (process.env.NODE_ENV !== "production") return;
  let hostname;
  try {
    hostname = new URL(rawUrl).hostname;
  } catch {
    throw new Error("Invalid URL");
  }
  const h = hostname.toLowerCase().replace(/\.$/, "");
  if (h === "localhost" || h === "0.0.0.0")
    throw new Error("SSRF: private host blocked");
  if (/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(h))
    throw new Error("SSRF: private IP range blocked");
}

/** Return the URL unchanged only if the scheme is http or https; otherwise return null. */
function sanitizeUrl(url) {
  if (!url) return url;
  try {
    const { protocol } = new URL(url);
    if (protocol === "http:" || protocol === "https:") return url;
  } catch {}
  return null;
}

// ── Startup: migrate / seed breeds.json with IDs ─────────────────────────────
async function seedDb() {
  // Breeds
  if (!existsSync(BREEDS_DB)) {
    let breeds = null;
    const oldPersistent = path.join(IMG_DIR, "_breeds.json");
    if (existsSync(oldPersistent)) breeds = await loadDb(oldPersistent);
    if (!breeds) breeds = (await loadDb(BREEDS_BUNDLED)) ?? [];
    let nextId = 1;
    breeds = breeds.map((b) => {
      if (b.id) {
        nextId = Math.max(nextId, b.id + 1);
        return b;
      }
      return { id: nextId++, ...b };
    });
    await saveDb(BREEDS_DB, breeds);
    console.log(`DB seeded — ${breeds.length} breeds`);
  }

  // Migration: purpose string → tags array
  {
    let breeds = (await loadDb(BREEDS_DB)) ?? [];
    let migrated = false;
    // First, ensure all breeds have IDs
    let nextId = 1;
    breeds = breeds.map((b) => {
      // Ensure breed has an ID
      const breedWithId = b.id ? b : { id: nextId++, ...b };
      if (b.id && b.id >= nextId) nextId = b.id + 1;

      if (!Array.isArray(breedWithId.tags)) {
        const tags = breedWithId.purpose
          ? breedWithId.purpose
              .split("/")
              .map((t) => t.trim())
              .filter(Boolean)
          : [];
        const { purpose, ...rest } = breedWithId;
        migrated = true;
        return { ...rest, tags: normalizeTags(tags) };
      }
      // Also normalize any existing tags that might be wrong case
      const normalized = normalizeTags(breedWithId.tags);
      if (normalized.join(",") !== breedWithId.tags.join(",")) {
        migrated = true;
        return { ...breedWithId, tags: normalized };
      }
      return breedWithId;
    });
    if (migrated) {
      await saveDb(BREEDS_DB, breeds);
      console.log("Migrated purpose → tags");
    }
  }

  // Accounts — seed admin from env vars only (no hardcoded credentials)
  let accounts = (await loadDb(ACCOUNTS_DB)) ?? [];
  const adminSeeds = [];
  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASS) {
    adminSeeds.push({
      email: process.env.ADMIN_EMAIL,
      password: process.env.ADMIN_PASS,
    });
  }
  let changed = false;
  for (const seed of adminSeeds) {
    if (!accounts.find((a) => a.email === seed.email)) {
      const nextId =
        accounts.length > 0
          ? Math.max(...accounts.map((a) => a.id || 0)) + 1
          : 1;
      accounts.push({
        id: nextId,
        email: seed.email,
        passwordHash: await bcrypt.hash(seed.password, 12),
        role: "admin",
        createdAt: new Date().toISOString(),
      });
      console.log(`Admin seeded: ${seed.email}`);
      changed = true;
    }
  }
  if (changed) await saveDb(ACCOUNTS_DB, accounts);

  // Also ensure admin exists in SQLite
  try {
    const db = getDb();
    for (const seed of adminSeeds) {
      const existing = db
        .prepare("SELECT id FROM accounts WHERE email = ?")
        .get(seed.email);
      if (!existing) {
        const passwordHash = await bcrypt.hash(seed.password, 12);
        const stmt = db.prepare(
          "INSERT OR IGNORE INTO accounts (id, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)",
        );
        stmt.run(
          null,
          seed.email,
          passwordHash,
          "admin",
          new Date().toISOString(),
        );
        console.log(`Admin seeded in SQLite: ${seed.email}`);
      }
    }
  } catch (err) {
    console.warn("⚠️ Could not seed admin in SQLite:", err.message);
  }
}

const app = express();
app.set("trust proxy", 1); // Required on Railway/Heroku so secure cookies work behind HTTPS proxy
app.use(compression()); // gzip all responses
app.use(express.json({ limit: "25mb" }));
app.use(
  helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }),
);
// A07 brute-force protection: cap auth endpoints at 30 requests per 15 min per IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === "test", // disable in test environment
  message: { error: "Too many requests, please try again later." },
});

// ── Session ───────────────────────────────────────────────────────────────────
app.use(
  session({
    secret: process.env.SESSION_SECRET || "herdhub-dev-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days (expanded from 7)
    },
  }),
);

// ── Auth middleware ────────────────────────────────────────────────────────────
function requireUser(req, res, next) {
  if (!sessionUser(req))
    return res.status(401).json({ error: "Login required" });
  next();
}

function requireAdmin(req, res, next) {
  const u = sessionUser(req);
  if (!u || u.role !== "admin")
    return res.status(403).json({ error: "Forbidden" });
  next();
}

// ── API: auth ─────────────────────────────────────────────────────────────────

app.get("/api/me", (req, res) => {
  const u = sessionUser(req);
  if (!u) return res.json({ role: "guest" });
  res.json({
    email: u.email,
    role: u.role,
    impersonating: !!req.session.adminBackup,
  });
});

app.post("/api/login", authLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "Email and password required" });

  // Try SQLite first, then fall back to JSON
  let account = null;
  try {
    const db = getDb();
    account = db
      .prepare("SELECT * FROM accounts WHERE email = ?")
      .get(email.toLowerCase());
  } catch (err) {
    console.warn("⚠️ SQLite login failed, falling back to JSON:", err.message);
    const accounts = (await loadDb(ACCOUNTS_DB)) ?? [];
    account = accounts.find(
      (a) => a.email.toLowerCase() === email.toLowerCase(),
    );
  }

  const ok =
    account &&
    (await bcrypt.compare(
      password,
      account.passwordHash || account.password_hash,
    ));
  if (!ok) {
    const prefix = process.env.NODE_ENV === "test" ? "[AUTH warn]" : "[AUTH]";
    console.warn(`${prefix} Failed login for: ${email} from ${req.ip}`);
    return res.status(401).json({ error: "Invalid email or password" });
  }
  // Regenerate session ID to prevent session fixation (A07)
  await new Promise((resolve, reject) =>
    req.session.regenerate((err) => (err ? reject(err) : resolve())),
  );
  req.session.user = { email: account.email, role: account.role };
  // remember=true → 30-day persistent cookie; false → expires when browser closes
  const remember = req.body.remember !== false;
  if (remember)
    req.session.cookie.maxAge = 90 * 24 * 60 * 60 * 1000; // 90 days for "remember me"
  else req.session.cookie.expires = false;
  res.json({ email: account.email, role: account.role });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.post("/api/register", authLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "Email and password required" });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: "Invalid email address" });
  if (password.length < 8)
    return res
      .status(400)
      .json({ error: "Password must be at least 8 characters" });

  try {
    // Try SQLite first
    const db = getDb();
    const existing = db
      .prepare("SELECT id FROM accounts WHERE email = ?")
      .get(email.toLowerCase());
    if (existing)
      return res.status(409).json({ error: "Email already registered" });

    const passwordHash = await bcrypt.hash(password, 12);
    const createdAt = new Date().toISOString();

    // Insert with null ID for AUTOINCREMENT
    const stmt = db.prepare(
      "INSERT INTO accounts (id, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)",
    );
    const info = stmt.run(
      null,
      email.toLowerCase(),
      passwordHash,
      "user",
      createdAt,
    );

    // Also write to JSON via saveDb for dual-write during migration
    const newAccount = {
      id: info.lastInsertRowid,
      email: email.toLowerCase(),
      passwordHash,
      role: "user",
      createdAt,
    };
    const accounts = (await loadDb(ACCOUNTS_DB)) ?? [];
    accounts.push(newAccount);
    await saveDb(ACCOUNTS_DB, accounts);

    // Regenerate session ID to prevent session fixation (A07)
    await new Promise((resolve, reject) =>
      req.session.regenerate((err) => (err ? reject(err) : resolve())),
    );
    req.session.user = { email: email.toLowerCase(), role: "user" };
    res.status(201).json({
      id: info.lastInsertRowid,
      email: email.toLowerCase(),
      role: "user",
    });
  } catch (err) {
    console.warn(
      "⚠️ SQLite registration failed, falling back to JSON:",
      err.message,
    );
    // Fall back to JSON
    const accounts = (await loadDb(ACCOUNTS_DB)) ?? [];
    if (accounts.find((a) => a.email.toLowerCase() === email.toLowerCase())) {
      return res.status(409).json({ error: "Email already registered" });
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const nextId =
      accounts.length > 0 ? Math.max(...accounts.map((a) => a.id || 0)) + 1 : 1;
    const newAccount = {
      id: nextId,
      email: email.toLowerCase(),
      passwordHash,
      role: "user",
      createdAt: new Date().toISOString(),
    };
    accounts.push(newAccount);
    await saveDb(ACCOUNTS_DB, accounts);
    // Regenerate session ID to prevent session fixation (A07)
    await new Promise((resolve, reject) =>
      req.session.regenerate((err) => (err ? reject(err) : resolve())),
    );
    req.session.user = { email: newAccount.email, role: newAccount.role };
    res.status(201).json({ email: newAccount.email, role: newAccount.role });
  }
});

// ── API: account management (admin only) ──────────────────────────────────────

app.get("/api/accounts", requireAdmin, async (req, res) => {
  try {
    const db = getDb();
    const accounts = db
      .prepare("SELECT id, email, role, created_at FROM accounts")
      .all();
    res.json(accounts);
  } catch (err) {
    console.warn("⚠️ SQLite read failed, falling back to JSON:", err.message);
    const accounts = (await loadDb(ACCOUNTS_DB)) ?? [];
    res.json(accounts.map(({ passwordHash: _, ...rest }) => rest));
  }
});

app.patch("/api/accounts/:id", requireAdmin, async (req, res) => {
  try {
    const db = getDb();
    const account = db
      .prepare("SELECT * FROM accounts WHERE id = ?")
      .get(req.params.id);
    if (!account) return res.status(404).json({ error: "Not found" });

    const { role, password } = req.body;
    if (role) {
      db.prepare("UPDATE accounts SET role = ? WHERE id = ?").run(
        role,
        req.params.id,
      );
    }
    if (password) {
      if (password.length < 8)
        return res
          .status(400)
          .json({ error: "Password must be at least 8 characters" });
      const hash = await bcrypt.hash(password, 12);
      db.prepare("UPDATE accounts SET password_hash = ? WHERE id = ?").run(
        hash,
        req.params.id,
      );
    }
    const updated = db
      .prepare("SELECT id, email, role, created_at FROM accounts WHERE id = ?")
      .get(req.params.id);
    res.json(updated);
  } catch (err) {
    console.warn("⚠️ SQLite patch failed, falling back to JSON:", err.message);
    const accounts = (await loadDb(ACCOUNTS_DB)) ?? [];
    const idx = accounts.findIndex(
      (a) => String(a.id) === String(req.params.id),
    );
    if (idx === -1) return res.status(404).json({ error: "Not found" });
    const { role, password } = req.body;
    if (role) accounts[idx].role = role;
    if (password) {
      if (password.length < 8)
        return res
          .status(400)
          .json({ error: "Password must be at least 8 characters" });
      accounts[idx].passwordHash = await bcrypt.hash(password, 12);
    }
    await saveDb(ACCOUNTS_DB, accounts);
    const { passwordHash: _, ...safe } = accounts[idx];
    res.json(safe);
  }
});

app.delete("/api/accounts/:id", requireAdmin, async (req, res) => {
  try {
    const db = getDb();
    const info = db
      .prepare("DELETE FROM accounts WHERE id = ?")
      .run(req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (err) {
    console.warn("⚠️ SQLite delete failed, falling back to JSON:", err.message);
    let accounts = (await loadDb(ACCOUNTS_DB)) ?? [];
    const before = accounts.length;
    accounts = accounts.filter((a) => String(a.id) !== String(req.params.id));
    if (accounts.length === before)
      return res.status(404).json({ error: "Not found" });
    await saveDb(ACCOUNTS_DB, accounts);
    res.json({ ok: true });
  }
});

// POST /api/accounts — admin creates a new account directly
app.post("/api/accounts", requireAdmin, async (req, res) => {
  try {
    const { email, password, role = "user" } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: "Email and password required" });
    if (password.length < 8)
      return res
        .status(400)
        .json({ error: "Password must be at least 8 characters" });
    if (!["user", "admin"].includes(role))
      return res.status(400).json({ error: "Invalid role" });

    const db = getDb();
    const existing = db
      .prepare("SELECT id FROM accounts WHERE email = ?")
      .get(email.toLowerCase());
    if (existing)
      return res.status(409).json({ error: "Email already registered" });

    const passwordHash = await bcrypt.hash(password, 12);
    const createdAt = new Date().toISOString();

    const stmt = db.prepare(
      "INSERT INTO accounts (id, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)",
    );
    const info = stmt.run(
      null,
      email.toLowerCase(),
      passwordHash,
      role,
      createdAt,
    );

    // Also write to JSON via saveDb for dual-write during migration
    const newAccount = {
      id: info.lastInsertRowid,
      email: email.toLowerCase(),
      passwordHash,
      role,
      createdAt,
    };
    const accounts = (await loadDb(ACCOUNTS_DB)) ?? [];
    accounts.push(newAccount);
    await saveDb(ACCOUNTS_DB, accounts);

    // Do NOT overwrite the current session - admin stays logged in as themselves
    res.status(201).json({ id: info.lastInsertRowid, email, role, createdAt });
  } catch (err) {
    console.warn("⚠️ SQLite create failed, falling back to JSON:", err.message);
    const { email, password, role = "user" } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: "Email and password required" });
    if (password.length < 8)
      return res
        .status(400)
        .json({ error: "Password must be at least 8 characters" });
    if (!["user", "admin"].includes(role))
      return res.status(400).json({ error: "Invalid role" });
    const accounts = (await loadDb(ACCOUNTS_DB)) ?? [];
    if (accounts.find((a) => a.email.toLowerCase() === email.toLowerCase())) {
      return res.status(409).json({ error: "Email already registered" });
    }
    const nextId =
      accounts.length > 0 ? Math.max(...accounts.map((a) => a.id || 0)) + 1 : 1;
    const newAccount = {
      id: nextId,
      email,
      passwordHash: await bcrypt.hash(password, 12),
      role,
      createdAt: new Date().toISOString(),
    };
    accounts.push(newAccount);
    await saveDb(ACCOUNTS_DB, accounts);
    // Do NOT overwrite the current session - admin stays logged in as themselves
    const { passwordHash: _, ...safe } = newAccount;
    res.status(201).json(safe);
  }
});

// ── API: admin impersonation ───────────────────────────────────────────────────

app.post("/api/impersonate/:id", requireAdmin, async (req, res) => {
  if (req.session.adminBackup)
    return res.status(400).json({ error: "Already impersonating" });
  const accounts = (await loadDb(ACCOUNTS_DB)) ?? [];
  const target = accounts.find((a) => String(a.id) === String(req.params.id));
  if (!target) return res.status(404).json({ error: "Account not found" });
  req.session.adminBackup = req.session.user;
  req.session.user = { email: target.email, role: target.role };
  res.json({ email: target.email, role: target.role, impersonating: true });
});

app.post("/api/unimpersonate", (req, res) => {
  if (!req.session?.adminBackup)
    return res.status(400).json({ error: "Not impersonating" });
  req.session.user = req.session.adminBackup;
  delete req.session.adminBackup;
  res.json({ email: req.session.user.email, role: req.session.user.role });
});

// GET all breeds — no auth, guests can browse
app.get("/api/breeds", async (req, res) => {
  try {
    const db = getDb();
    const breeds = db
      .prepare(
        "SELECT id, species, name, origin, subspecies, image_url as imageUrl, wiki_url as wikiUrl, props FROM breeds",
      )
      .all();
    // Parse props JSON and add tags field for frontend compatibility
    const breedsWithTags = breeds.map(parseBreedProps);
    console.log(`✅ /api/breeds returning ${breedsWithTags.length} breeds`);
    res.json(breedsWithTags);
  } catch (err) {
    console.warn("⚠️ SQLite read failed, falling back to JSON:", err.message);
    const breeds = (await loadDb(BREEDS_DB)) ?? [];
    console.log(
      `✅ /api/breeds (JSON fallback) returning ${breeds.length} breeds`,
    );
    res.json(breeds.map(({ localImage: _, ...b }) => b));
  }
});

// PATCH one breed (admin only) — partial update to master list
app.patch("/api/breeds/:id", requireAdmin, async (req, res) => {
  try {
    const db = getDb();
    const id = Number(req.params.id);
    const breed = db.prepare("SELECT * FROM breeds WHERE id = ?").get(id);
    if (!breed) return res.status(404).json({ error: "Not found" });

    let body = { ...req.body };
    if (body.imageUrl) body.imageUrl = body.imageUrl.split("?")[0];
    if ("wikiUrl" in body) body.wikiUrl = sanitizeUrl(body.wikiUrl);

    // Download external image if provided
    if (body.imageUrl && /^https?:\/\//.test(body.imageUrl)) {
      try {
        body.imageUrl = await downloadAndSaveImage(
          body.imageUrl,
          id,
          body.name || breed.name,
        );
      } catch (err) {
        // Log download errors in development/test mode
        if (process.env.NODE_ENV !== "production") {
          console.warn("⚠️ Image download failed:", err.message);
        }
        // Keep the external URL on error
      }
    }

    // Handle tags stored in props JSON
    const props = breed.props ? JSON.parse(breed.props) : {};
    if (body.tags) {
      props.tags = normalizeTags(body.tags);
      delete body.tags;
    }

    const updates = [];
    const values = [];
    const map = {
      name: "name",
      origin: "origin",
      subspecies: "subspecies",
      imageUrl: "image_url",
      wikiUrl: "wiki_url",
    };

    for (const [key, dbCol] of Object.entries(map)) {
      if (body[key] !== undefined) {
        updates.push(`${dbCol} = ?`);
        values.push(body[key]);
      }
    }
    if (body.tags || body.props) {
      updates.push("props = ?");
      values.push(JSON.stringify(props));
    }
    updates.push("updated_at = ?");
    values.push(new Date().toISOString());
    values.push(id);

    if (updates.length > 0) {
      db.prepare(`UPDATE breeds SET ${updates.join(", ")} WHERE id = ?`).run(
        ...values,
      );
    }

    const updated = db.prepare("SELECT * FROM breeds WHERE id = ?").get(id);
    res.json(parseBreedProps(updated));
  } catch (err) {
    console.warn("⚠️ SQLite patch failed, falling back to JSON:", err.message);
    try {
      const id = Number(req.params.id);
      const breeds = (await loadDb(BREEDS_DB)) ?? [];
      const idx = breeds.findIndex((b) => b.id === id);
      if (idx === -1) return res.status(404).json({ error: "Not found" });
      let body = { ...req.body };
      if (body.imageUrl) body.imageUrl = body.imageUrl.split("?")[0];
      if ("wikiUrl" in body) body.wikiUrl = sanitizeUrl(body.wikiUrl);
      breeds[idx] = { ...breeds[idx], ...body, id };
      if (body.tags) breeds[idx].tags = normalizeTags(body.tags);
      await saveDb(BREEDS_DB, breeds);
      res.json(breeds[idx]);
    } catch (fallbackErr) {
      res.status(500).json({ error: String(fallbackErr) });
    }
  }
});

// POST new breed (admin only)
app.post("/api/breeds", requireAdmin, async (req, res) => {
  try {
    const db = getDb();
    const maxId = db.prepare("SELECT MAX(id) as max FROM breeds").get();
    const nextId = (maxId.max || 0) + 1;

    const newBreed = {
      id: nextId,
      name: "",
      origin: null,
      subspecies: null,
      tags: [],
      imageUrl: null,
      wikiUrl: null,
      ...req.body,
      id: nextId,
    };
    newBreed.tags = normalizeTags(newBreed.tags);
    if (newBreed.wikiUrl) newBreed.wikiUrl = sanitizeUrl(newBreed.wikiUrl);

    if (newBreed.imageUrl && /^https?:\/\//.test(newBreed.imageUrl)) {
      try {
        newBreed.imageUrl = await downloadAndSaveImage(
          newBreed.imageUrl,
          nextId,
          newBreed.name,
        );
      } catch (err) {
        console.error("Failed to download breed image:", err.message);
      }
    }

    const props = JSON.stringify({ tags: newBreed.tags });
    db.prepare(
      "INSERT INTO breeds (id, species, name, origin, subspecies, image_url, wiki_url, props, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      nextId,
      "cattle",
      newBreed.name,
      newBreed.origin,
      newBreed.subspecies,
      newBreed.imageUrl,
      newBreed.wikiUrl,
      props,
      new Date().toISOString(),
      new Date().toISOString(),
    );

    const inserted = db
      .prepare("SELECT * FROM breeds WHERE id = ?")
      .get(nextId);
    res.status(201).json(parseBreedProps(inserted));
  } catch (err) {
    console.warn("⚠️ SQLite create failed, falling back to JSON:", err.message);
    try {
      const breeds = (await loadDb(BREEDS_DB)) ?? [];
      const nextId = breeds.reduce((m, b) => Math.max(m, b.id ?? 0), 0) + 1;
      const newBreed = {
        id: nextId,
        name: "",
        origin: null,
        subspecies: null,
        tags: [],
        imageUrl: null,
        wikiUrl: null,
        ...req.body,
        id: nextId,
      };
      newBreed.tags = normalizeTags(newBreed.tags);
      if (newBreed.wikiUrl) newBreed.wikiUrl = sanitizeUrl(newBreed.wikiUrl);
      if (newBreed.imageUrl && /^https?:\/\//.test(newBreed.imageUrl)) {
        try {
          newBreed.imageUrl = await downloadAndSaveImage(
            newBreed.imageUrl,
            nextId,
            newBreed.name,
          );
        } catch (err) {
          // Log download errors in development/test mode
          if (process.env.NODE_ENV !== "production") {
            console.warn("⚠️ Image download failed:", err.message);
          }
        }
      }
      breeds.push(newBreed);
      await saveDb(BREEDS_DB, breeds);
      res.status(201).json(newBreed);
    } catch (fallbackErr) {
      res.status(500).json({ error: String(fallbackErr) });
    }
  }
});

// POST /api/breeds/import — replace entire master list (admin only)
// Accepts a JSON array; ensures every entry has a stable id
app.post("/api/breeds/import", requireAdmin, async (req, res) => {
  try {
    const incoming = req.body;
    if (!Array.isArray(incoming))
      return res.status(400).json({ error: "Expected array" });

    const db = getDb();
    const insertBreed = db.prepare(
      "INSERT OR REPLACE INTO breeds (id, species, name, origin, subspecies, image_url, wiki_url, props, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );

    const runImport = db.transaction((data) => {
      db.prepare("DELETE FROM breeds").run();
      data.forEach((b) => {
        const tags = normalizeTags(
          b.tags ??
            (b.purpose ? b.purpose.split("/").map((t) => t.trim()) : []),
        );
        const props = JSON.stringify({ tags });
        insertBreed.run(
          b.id,
          "cattle",
          b.name,
          b.origin,
          b.subspecies,
          b.imageUrl,
          b.wikiUrl,
          props,
          b.created_at || new Date().toISOString(),
          new Date().toISOString(),
        );
      });
    });
    runImport(incoming);
    res.json({ ok: true, count: incoming.length });
  } catch (err) {
    console.warn("⚠️ SQLite import failed, falling back to JSON:", err.message);
    try {
      const incoming = req.body;
      if (!Array.isArray(incoming))
        return res.status(400).json({ error: "Expected array" });
      let nextId = 1;
      const breeds = incoming.map((b) => {
        const tags = normalizeTags(
          b.tags ??
            (b.purpose ? b.purpose.split("/").map((t) => t.trim()) : []),
        );
        if (b.id) {
          nextId = Math.max(nextId, b.id + 1);
          return { ...b, tags };
        }
        return { id: nextId++, ...b, tags };
      });
      await saveDb(BREEDS_DB, breeds);
      res.json({ ok: true, count: breeds.length });
    } catch (fallbackErr) {
      res.status(500).json({ error: String(fallbackErr) });
    }
  }
});

// DELETE breed (admin only)
app.delete("/api/breeds/:id", requireAdmin, async (req, res) => {
  try {
    const db = getDb();
    const info = db
      .prepare("DELETE FROM breeds WHERE id = ?")
      .run(req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (err) {
    console.warn("⚠️ SQLite delete failed, falling back to JSON:", err.message);
    try {
      const id = Number(req.params.id);
      let breeds = (await loadDb(BREEDS_DB)) ?? [];
      const before = breeds.length;
      breeds = breeds.filter((b) => b.id !== id);
      if (breeds.length === before)
        return res.status(404).json({ error: "Not found" });
      await saveDb(BREEDS_DB, breeds);
      res.json({ ok: true });
    } catch (fallbackErr) {
      res.status(500).json({ error: String(fallbackErr) });
    }
  }
});

// ── API: my herd (registered users only) ─────────────────────────────────────

// GET user's herd
app.get("/api/myherd", requireUser, async (req, res) => {
  try {
    const db = getDb();
    const email = sessionUser(req).email;
    const user = db
      .prepare("SELECT id FROM accounts WHERE email = ?")
      .get(email);
    if (!user) return res.json([]);
    const herd = db
      .prepare(
        "SELECT breed_id as id, custom_name as name, custom_image_url as imageUrl, custom_notes as notes, created_at FROM user_herds WHERE user_id = ?",
      )
      .all(user.id);
    res.json(herd);
  } catch (err) {
    console.warn("⚠️ SQLite read failed, falling back to JSON:", err.message);
    const herd = (await loadDb(userMyherdFile(sessionUser(req).email))) ?? [];
    res.json(herd);
  }
});

// PUT replace user's entire herd
app.put("/api/myherd", requireUser, async (req, res) => {
  try {
    const herd = req.body;
    if (!Array.isArray(herd))
      return res.status(400).json({ error: "Expected array" });
    const user = sessionUser(req);
    const b64email = Buffer.from(user.email).toString("base64url");

    // Process breeds: strip cache-busting params, download any new external imageUrls
    const clean = await Promise.all(
      herd.map(async (b) => {
        let imageUrl = b.imageUrl ? b.imageUrl.split("?")[0] : b.imageUrl;
        if (imageUrl && /^https?:\/\//.test(imageUrl)) {
          try {
            const nameSlug = (b.name || "breed")
              .replace(/[^a-zA-Z0-9]/g, "_")
              .replace(/_+/g, "_")
              .toLowerCase();
            const stem = b.id ? `${b.id}_${nameSlug}_1` : nameSlug;
            let ext;
            try {
              ext = path.extname(new URL(imageUrl).pathname).toLowerCase();
            } catch {
              ext = "";
            }
            if (!IMAGE_EXTS.has(ext)) ext = ".jpg";
            const filename = `${stem}${ext}`;
            const destDir = path.join(IMG_DIR, "users", b64email);
            const relpath = `users/${b64email}/${filename}`;
            const dest = path.join(destDir, filename);
            // Always download and overwrite — user may be setting a different image
            // for a breed that already has a local file at this path.
            // Generate thumbnail from the in-memory buffer (not by re-reading the file
            // from disk) to avoid Windows/libvips file-lock races on overwrite.
            await mkdir(destDir, { recursive: true });
            assertNoSsrf(imageUrl); // A10: block server-side fetch of private/internal URLs
            const resp = await fetchWithRetry(imageUrl, {
              headers: { "User-Agent": "HerdHub/1.0 (cattle breed catalogue)" },
            });
            const ct = resp.headers.get("content-type") ?? "";
            if (
              !ct.startsWith("image/") &&
              !ct.startsWith("application/octet-stream")
            ) {
              throw new Error(`Not an image (content-type: ${ct})`);
            }
            const buf = Buffer.from(await resp.arrayBuffer());
            await writeFile(dest, buf);
            await deleteStaleThumb(relpath);
            const flatStem = relpath
              .replace(/[/\\]/g, "_")
              .replace(/\.[^.]+$/, "");
            const thumbDst = path.join(THUMB_DIR, `${flatStem}_thumb.webp`);
            await mkdir(THUMB_DIR, { recursive: true });
            try {
              await sharp(buf)
                .resize({
                  width: 400,
                  height: 300,
                  fit: "cover",
                  position: "centre",
                })
                .webp({ quality: 80 })
                .toFile(thumbDst);
            } catch (e) {
              if (process.env.NODE_ENV !== "test") {
                console.warn(`Thumb gen failed for ${relpath}:`, e.message);
              }
            }
            imageUrl = `/images/${relpath}`;
          } catch (e) {
            console.warn(`Image download failed on PUT myherd: ${e.message}`);
          }
        }
        return {
          ...b,
          wikiUrl: b.wikiUrl ? sanitizeUrl(b.wikiUrl) : b.wikiUrl,
          imageUrl,
        };
      }),
    );

    await saveDb(userMyherdFile(user.email), clean);
    res.json({ ok: true, count: clean.length });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── API: image upload (registered users only) ─────────────────────────────────
app.post("/api/upload-image", requireUser, async (req, res) => {
  try {
    const { name, breedId, dataUrl, context } = req.body;
    const user = sessionUser(req);
    console.log(
      `[UPLOAD] user=${user.email} role=${user.role} context=${context}`,
    );
    // Admin uploading for the master list → global images dir; everyone else → user-scoped subdir
    const isAdminMaster = user.role === "admin" && context === "master";

    const nameSlug = name
      .replace(/[^a-zA-Z0-9]/g, "_")
      .replace(/_+/g, "_")
      .toLowerCase();
    const stem = breedId ? `${breedId}_${nameSlug}_1` : nameSlug;
    const ext =
      dataUrl.match(/^data:image\/(\w+);/)?.[1]?.replace("jpeg", "jpg") ??
      "jpg";
    const filename = `${stem}.${ext}`;

    let destDir, relpath;
    if (isAdminMaster) {
      destDir = IMG_DIR;
      relpath = filename;
    } else {
      const b64email = Buffer.from(user.email).toString("base64url");
      destDir = path.join(IMG_DIR, "users", b64email);
      relpath = `users/${b64email}/${filename}`;
    }

    const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
    const imgBuf = Buffer.from(base64, "base64");
    await mkdir(destDir, { recursive: true });
    await writeFile(path.join(destDir, filename), imgBuf);

    // Delete stale thumbnail
    const { unlink } = await import("fs/promises");
    const flatStem = relpath.replace(/[\/\\]/g, "_").replace(/\.[^.]+$/, "");
    const thumbName = `${flatStem}_thumb.webp`;
    const staleThumb = path.join(THUMB_DIR, thumbName);
    await unlink(staleThumb).catch(() => {});

    // Generate thumbnail from the in-memory buffer — avoids any file lock on the source image.
    // Using the buffer means Windows can't lock the just-written file via libvips.
    await mkdir(THUMB_DIR, { recursive: true });
    try {
      await sharp(imgBuf)
        .resize(400, 300, { fit: "inside" })
        .webp({ quality: 75 })
        .toFile(staleThumb);
    } catch (e) {
      if (process.env.NODE_ENV !== "test") {
        console.warn(`Thumbnail generation failed:`, e.message);
      }
    }

    // Return path with cache-busting timestamp so the browser fetches the new thumbnail
    res.json({ path: `/images/${relpath}?t=${Date.now()}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

// Thumbnail helpers
const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"]);
const PUBLIC_IMG = path.join(__dirname, "public", "images");
const DIST_IMG = path.join(DIST_DIR, "images");
// Pre-downloaded images from the scrape script at the workspace root
const COW_IMG = path.join(__dirname, "..", "images");

/** Find the source file for a given relative image path across all known image locations.
 * relpath may be a flat filename ('file.jpg') or user-scoped ('users/<b64>/<file>.jpg'). */
function findImageSrc(relpath) {
  // Try full relative path first (handles user subdirs in IMG_DIR)
  const inVolume = path.join(IMG_DIR, relpath);
  if (existsSync(inVolume)) return inVolume;
  // Basename-only fallback for legacy/static locations
  const fn = path.basename(relpath);
  for (const dir of [DIST_IMG, PUBLIC_IMG, COW_IMG]) {
    const p = path.join(dir, fn);
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Fetch a URL with retry and exponential backoff (3 attempts, 400/800 ms delays).
 * Throws after all attempts are exhausted.
 */
async function fetchWithRetry(url, opts = {}, maxAttempts = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(20000),
        ...opts,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts)
        await new Promise((r) => setTimeout(r, 400 * 2 ** (attempt - 1)));
    }
  }
  throw lastErr;
}

/**
 * Download an external image URL (or copy from localImage), save locally as [id]_[name]_[slot][ext],
 * generate a thumbnail synchronously, and return the local /images/... path.
 */
/**
 * Delete the cached WebP thumbnail for a given image relpath so the next
 * call to generateThumb() regenerates it from the new source file.
 */
async function deleteStaleThumb(relpath) {
  const { unlink } = await import("fs/promises");
  const flatStem = relpath.replace(/[/\\]/g, "_").replace(/\.[^.]+$/, "");
  await unlink(path.join(THUMB_DIR, `${flatStem}_thumb.webp`)).catch(() => {});
}

/**
 * Download an external image URL (or copy from localImage), write to disk,
 * invalidate any cached thumbnail, regenerate the thumbnail, and return the
 * local /images/... path.
 *
 * @param {string}  externalUrl    http://, https://, or data: URL
 * @param {number}  breedId
 * @param {string}  breedName
 * @param {number}  [slot=1]
 * @param {string}  [localImageHint]  relative path hint for the local stash
 * @param {boolean} [overwrite=true]  false = skip if the dest file already
 *                                    exists (used by the startup backfill scan)
 */
async function downloadAndSaveImage(
  externalUrl,
  breedId,
  breedName,
  slot = 1,
  localImageHint = null,
  overwrite = true,
) {
  const nameSlug = breedName
    .replace(/[^a-zA-Z0-9]/g, "_")
    .replace(/_+/g, "_")
    .toLowerCase();

  /**
   * Write imgBuf to dest, invalidate the stale cached thumbnail, then regenerate
   * the thumbnail from the in-memory buffer.  Generating from the buffer — not
   * by re-reading the file from disk — avoids the Windows/libvips file-lock race
   * where sharp still holds a read handle on a file we are about to overwrite.
   * This is the same pattern used by POST /api/upload-image.
   */
  const writeAndThumb = async (destPath, imgBuf, relpath) => {
    await mkdir(path.dirname(destPath), { recursive: true });
    await writeFile(destPath, imgBuf);
    const flatStem = relpath.replace(/[/\\]/g, "_").replace(/\.[^.]+$/, "");
    const thumbDst = path.join(THUMB_DIR, `${flatStem}_thumb.webp`);
    await mkdir(THUMB_DIR, { recursive: true });
    // Unlink stale thumb before writing so the new file gets a clean inode;
    // do this right before the write to minimise the window with no thumb.
    await deleteStaleThumb(relpath);
    try {
      await sharp(imgBuf)
        .resize({ width: 400, height: 300, fit: "cover", position: "centre" })
        .webp({ quality: 80 })
        .toFile(thumbDst);
    } catch (e) {
      if (process.env.NODE_ENV !== "test") {
        console.warn(`Thumb gen failed for ${relpath}:`, e.message);
      }
    }
  };

  // Handle inline base64 data URLs — decode directly, no HTTP needed
  if (externalUrl.startsWith("data:")) {
    const m = externalUrl.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
    if (!m) throw new Error("Unrecognised data URL format");
    let mimeExt = "." + m[1].split("+")[0]; // e.g. image/jpeg → .jpeg, image/svg+xml → .svg
    if (mimeExt === ".jpeg") mimeExt = ".jpg";
    if (!IMAGE_EXTS.has(mimeExt)) mimeExt = ".jpg";
    const filename = `${breedId}_${nameSlug}_${slot}${mimeExt}`;
    const dest = path.join(IMG_DIR, filename);
    if (overwrite || !existsSync(dest)) {
      const buf = Buffer.from(m[2], "base64");
      await writeAndThumb(dest, buf, filename);
    } else {
      await generateThumb(filename).catch((e) =>
        console.warn(`Thumb gen failed for ${filename}: ${e.message}`),
      );
    }
    return `/images/${filename}`;
  }

  let ext;
  try {
    ext = path.extname(new URL(externalUrl).pathname).toLowerCase();
  } catch {
    ext = "";
  }
  // Try to infer ext from the localImage hint if the URL ext is unhelpful
  if (!IMAGE_EXTS.has(ext) && localImageHint) {
    ext = path.extname(localImageHint).toLowerCase();
  }
  if (!IMAGE_EXTS.has(ext)) ext = ".jpg";
  const filename = `${breedId}_${nameSlug}_${slot}${ext}`;
  const dest = path.join(IMG_DIR, filename);
  if (overwrite || !existsSync(dest)) {
    // Prefer copying from the pre-downloaded stash over fetching from internet
    const hint = localImageHint
      ? path.join(__dirname, "..", localImageHint)
      : null;
    let buf;
    if (hint && existsSync(hint)) {
      buf = await readFile(hint);
    } else {
      // Wikimedia (and many CDNs) require a proper User-Agent or they return 403
      assertNoSsrf(externalUrl); // A10: block SSRF to private/internal addresses
      const resp = await fetchWithRetry(externalUrl, {
        headers: {
          "User-Agent":
            "HerdHub/1.0 (https://github.com/pauldenhertog256/HerdHub; cattle breed catalogue)",
        },
      });
      const ct = resp.headers.get("content-type") ?? "";
      if (
        !ct.startsWith("image/") &&
        !ct.startsWith("application/octet-stream")
      ) {
        throw new Error(`Not an image (content-type: ${ct})`);
      }
      buf = Buffer.from(await resp.arrayBuffer());
    }
    await writeAndThumb(dest, buf, filename);
  } else {
    await generateThumb(filename).catch((e) =>
      console.warn(`Thumb gen failed for ${filename}: ${e.message}`),
    );
  }
  return `/images/${filename}`;
}

// Deduplication: if concurrent requests arrive for the same thumb, share one promise
const thumbsInProgress = new Map();

/** Generate a 400×300 WebP thumbnail. Output name: [flat_stem]_thumb.webp. Idempotent + concurrent-safe.
 * relpath may include subdirs e.g. 'users/<b64>/file.jpg' — flattened to 'users_b64_file_thumb.webp'. */
async function generateThumb(relpath) {
  // Flatten path separators so user subdirs get unique thumb names
  const flatStem = relpath.replace(/[/\\]/g, "_").replace(/\.[^.]+$/, "");
  const thumbName = `${flatStem}_thumb.webp`;
  const dst = path.join(THUMB_DIR, thumbName);
  if (existsSync(dst)) return dst;
  if (thumbsInProgress.has(thumbName)) return thumbsInProgress.get(thumbName);
  const promise = (async () => {
    const src = findImageSrc(relpath);
    if (!src) return null;
    await mkdir(THUMB_DIR, { recursive: true });
    try {
      await sharp(src)
        .resize({ width: 400, height: 300, fit: "cover", position: "centre" })
        .webp({ quality: 80 })
        .toFile(dst);
    } catch (e) {
      if (process.env.NODE_ENV !== "test") {
        console.warn(`Thumb gen failed for ${relpath}:`, e.message);
      }
      return null;
    }
    return dst;
  })();
  promise.finally(() => thumbsInProgress.delete(thumbName));
  thumbsInProgress.set(thumbName, promise);
  return promise;
}

// GET /api/thumb/:filename — serve WebP thumbnail for locally-stored images.
// If thumbnail not yet cached, serve the original immediately and generate in background.
app.get("/api/thumb/*", async (req, res) => {
  const relpath = req.params[0];
  // Security: reject path traversal, null bytes, or overly deep paths
  if (!relpath || relpath.includes("..") || relpath.includes("\0"))
    return res.status(400).end();
  const segments = relpath.split("/");
  if (segments.length > 3) return res.status(400).end();
  // Each segment: alphanumeric, dots, hyphens, underscores (covers base64url + normal filenames)
  if (!segments.every((s) => /^[a-zA-Z0-9._\-]+$/.test(s)))
    return res.status(400).end();
  if (
    !IMAGE_EXTS.has(path.extname(segments[segments.length - 1]).toLowerCase())
  )
    return res.status(400).end();

  const flatStem = relpath.replace(/[/\\]/g, "_").replace(/\.[^.]+$/, "");
  const thumbName = `${flatStem}_thumb.webp`;
  const dst = path.join(THUMB_DIR, thumbName);
  if (existsSync(dst)) {
    res.setHeader("Cache-Control", "public, max-age=2592000, immutable");
    res.setHeader("Content-Type", "image/webp");
    return res.sendFile(dst);
  }

  // Not cached yet: serve the original while generating thumb in background
  const src = findImageSrc(relpath);
  if (!src) return res.status(404).end();
  generateThumb(relpath).catch(() => {});
  res.setHeader("Cache-Control", "public, max-age=2592000, immutable");
  res.sendFile(src);
});

// ── ZIP export / import ──────────────────────────────────────────────────────

/** Stream a zip archive of breeds + their referenced images to the response. */
async function buildBreedZip(breeds, res, filename) {
  const archive = archiver("zip", { zlib: { level: 6 } });
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  archive.pipe(res);
  archive.append(JSON.stringify(breeds, null, 2), { name: "breeds.json" });
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
    if (file.type === "Directory") continue;
    if (file.path === "breeds.json") {
      breedsData = JSON.parse((await file.buffer()).toString("utf8"));
    } else if (file.path.startsWith("images/")) {
      const fn = path.basename(file.path);
      if (!fn || fn.startsWith(".")) continue;
      if (!IMAGE_EXTS.has(path.extname(fn).toLowerCase())) continue; // reject non-image files (A08)
      await writeFile(path.join(IMG_DIR, fn), await file.buffer());
      imageCount++;
      generateThumb(fn).catch(() => {});
    }
  }
  if (!breedsData) throw new Error("breeds.json not found in zip");
  if (!Array.isArray(breedsData))
    throw new Error("breeds.json must be a JSON array");
  return { breedsData, imageCount };
}

// GET /api/export-zip — master breeds + images (admin)
app.get("/api/export-zip", requireAdmin, async (req, res) => {
  try {
    const breeds = (await loadDb(BREEDS_DB)) ?? [];
    const date = new Date().toISOString().slice(0, 10);
    await buildBreedZip(breeds, res, `Export_All_${date}.zip`);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: String(err) });
  }
});

// POST /api/import-zip — replace master breeds + images from zip (admin)
app.post(
  "/api/import-zip",
  requireAdmin,
  express.raw({ type: "*/*", limit: "200mb" }),
  async (req, res) => {
    try {
      const { breedsData, imageCount } = await extractBreedZip(req.body);
      let nextId = 1;
      const breeds = breedsData.map((b) => {
        const tags = normalizeTags(b.tags ?? []);
        if (b.id) {
          nextId = Math.max(nextId, b.id + 1);
          return { ...b, tags };
        }
        return { id: nextId++, ...b, tags };
      });
      await saveDb(BREEDS_DB, breeds);
      res.json({ ok: true, breeds: breeds.length, images: imageCount });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: String(err) });
    }
  },
);

// GET /api/myherd/export-zip — user's My Herd + images (any logged-in user)
app.get("/api/myherd/export-zip", requireUser, async (req, res) => {
  try {
    const db = getDb();
    const email = sessionUser(req).email;
    const user = db
      .prepare("SELECT id FROM accounts WHERE email = ?")
      .get(email);
    let herd = [];
    if (user) {
      herd = db
        .prepare(
          "SELECT breed_id as id, custom_name as name, custom_image_url as imageUrl, custom_notes as notes FROM user_herds WHERE user_id = ?",
        )
        .all(user.id);
    }
    const date = new Date().toISOString().slice(0, 10);
    await buildBreedZip(herd, res, `Export_My_Herd_${date}.zip`);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: String(err) });
  }
});

// POST /api/myherd/import-zip — replace user's My Herd + images from zip
app.post(
  "/api/myherd/import-zip",
  requireUser,
  express.raw({ type: "*/*", limit: "200mb" }),
  async (req, res) => {
    try {
      const { breedsData, imageCount } = await extractBreedZip(req.body);
      await saveDb(userMyherdFile(sessionUser(req).email), breedsData);
      res.json({ ok: true, breeds: breedsData.length, images: imageCount });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: String(err) });
    }
  },
);

// ── Admin Backup ──────────────────────────────────────────────────────────────
app.get("/api/admin/backup", requireAdmin, (req, res) => {
  const date = new Date().toISOString().slice(0, 10);
  const filename = `herdhub-backup-${date}.tar.gz`;
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Type", "application/gzip");

  const archive = archiver("tar", { gzip: true });
  archive.on("error", (err) => {
    if (!res.headersSent) res.status(500).json({ error: String(err) });
  });

  archive.pipe(res);
  archive.directory(DATA_DIR, false);
  archive.finalize();
});

// ── Migration Verification ──────────────────────────────────────────────────────
app.get("/api/verify-migration", requireAdmin, async (req, res) => {
  try {
    const db = getDb();
    const sqliteAccounts = db
      .prepare("SELECT COUNT(*) as count FROM accounts")
      .get().count;
    const sqliteBreeds = db
      .prepare("SELECT COUNT(*) as count FROM breeds")
      .get().count;
    const sqliteHerds = db
      .prepare("SELECT COUNT(*) as count FROM user_herds")
      .get().count;

    const jsonAccounts = JSON.parse(
      (await readFile(ACCOUNTS_DB, "utf8")) || "[]",
    ).length;
    const jsonBreeds = JSON.parse(
      (await readFile(BREEDS_DB, "utf8")) || "[]",
    ).length;

    let jsonHerds = 0;
    const usersDir = path.join(DB_DIR, "users");
    if (existsSync(usersDir)) {
      for (const folder of await readdir(usersDir)) {
        const herdPath = path.join(usersDir, folder, "myherd.json");
        if (existsSync(herdPath)) {
          jsonHerds += JSON.parse(
            (await readFile(herdPath, "utf8")) || "[]",
          ).length;
        }
      }
    }

    const match =
      sqliteAccounts === jsonAccounts &&
      sqliteBreeds === jsonBreeds &&
      sqliteHerds === jsonHerds;
    res.json({
      match,
      sqlite: {
        accounts: sqliteAccounts,
        breeds: sqliteBreeds,
        herds: sqliteHerds,
      },
      json: { accounts: jsonAccounts, breeds: jsonBreeds, herds: jsonHerds },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Static frontend (production) ──────────────────────────────────────────────
app.use(express.static(DIST_DIR));
// Images and thumbs are named with breed IDs — safe to cache for 30 days
// setHeaders ensures .avif files get the correct MIME type (some mime DBs omit it)
app.use("/images", express.static(IMG_DIR, {
  maxAge: "30d",
  immutable: true,
  setHeaders(res, filePath) {
    if (filePath.endsWith(".avif")) res.setHeader("Content-Type", "image/avif");
  },
}));

// SPA fallback — all non-API routes serve index.html
app.get("*", (req, res) => {
  res.sendFile(path.join(DIST_DIR, "index.html"));
});

/** Warm the thumbnail cache in the background at startup. Runs 10 concurrent. */
async function ensureAllThumbs() {
  try {
    const relpaths = new Set();
    // Flat master images in IMG_DIR
    if (existsSync(IMG_DIR)) {
      for (const f of await readdir(IMG_DIR)) {
        if (IMAGE_EXTS.has(path.extname(f).toLowerCase())) relpaths.add(f);
      }
      // User-scoped subdirs: IMG_DIR/users/<b64email>/
      const usersDir = path.join(IMG_DIR, "users");
      if (existsSync(usersDir)) {
        for (const userSlug of await readdir(usersDir)) {
          const userPath = path.join(usersDir, userSlug);
          for (const f of await readdir(userPath).catch(() => [])) {
            if (IMAGE_EXTS.has(path.extname(f).toLowerCase()))
              relpaths.add(`users/${userSlug}/${f}`);
          }
        }
      }
    }
    // Legacy/build static dirs (flat filenames only)
    for (const dir of [PUBLIC_IMG, DIST_IMG]) {
      if (!existsSync(dir)) continue;
      for (const f of await readdir(dir)) {
        if (IMAGE_EXTS.has(path.extname(f).toLowerCase())) relpaths.add(f);
      }
    }
    if (!relpaths.size) return;
    await mkdir(THUMB_DIR, { recursive: true });
    const arr = [...relpaths];
    const BATCH = 10;
    for (let i = 0; i < arr.length; i += BATCH) {
      await Promise.all(
        arr.slice(i, i + BATCH).map((f) => generateThumb(f).catch(() => {})),
      );
    }
    console.log(`Thumbnails ready (${arr.length} images)`);
  } catch (e) {
    console.warn("ensureAllThumbs error:", e.message);
  }
}

/**
 * Download all external imageUrls in breeds.json to IMG_DIR, update DB records
 * to local /images/... paths. Runs at startup in background. Restart-safe:
 * already-downloaded files are skipped, DB is saved after each batch.
 */
async function ensureLocalImages() {
  try {
    let breeds = (await loadDb(BREEDS_DB)) ?? [];
    const external = breeds.filter(
      (b) =>
        b.imageUrl &&
        (b.imageUrl.startsWith("data:") || /^https?:\/\//.test(b.imageUrl)),
    );
    if (!external.length) return;
    console.log(
      `Localising ${external.length} external breed images (copying from local stash where available)…`,
    );

    let saved = 0,
      failed = 0,
      dirty = false;
    for (const b of external) {
      const idx = breeds.findIndex((x) => x.id === b.id);
      if (idx === -1) continue;
      try {
        const localUrl = await downloadAndSaveImage(
          b.imageUrl,
          b.id,
          b.name,
          1,
          b.localImage ?? null,
          false,
        );
        breeds[idx] = { ...breeds[idx], imageUrl: localUrl };
        dirty = true;
        saved++;
        // Persist every 10 downloads so progress survives a restart
        if (saved % 10 === 0) {
          await saveDb(BREEDS_DB, breeds);
          dirty = false;
        }
      } catch (err) {
        console.warn(`  Failed "${b.name}": ${err.message}`);
        failed++;
      }
      // 500 ms between requests — avoids Wikimedia 429 rate-limiting
      if (/^https?:\/\//.test(b.imageUrl))
        await new Promise((r) => setTimeout(r, 500));
    }
    if (dirty) await saveDb(BREEDS_DB, breeds);
    console.log(`Image localisation done — ${saved} saved, ${failed} failed.`);
  } catch (e) {
    console.warn("ensureLocalImages error:", e.message);
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────
try {
  await seedDb();
  // These run in background — server is ready immediately
  ensureLocalImages().then(() => ensureAllThumbs());
} catch (error) {
  console.error("❌ Failed to seed database:", error.message);
  console.error("Stack trace:", error.stack);
  // Don't exit, continue running server
}
app.listen(PORT, () => console.log(`HerdHub → http://localhost:${PORT}`));
