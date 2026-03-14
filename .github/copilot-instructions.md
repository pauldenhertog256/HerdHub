# HerdHub — Copilot Instructions

## Terminal
- Always use **PowerShell** for terminal commands (not bash/sh)
- Kill processes on Windows with `Stop-Process` or `taskkill /F /PID <pid>`
- Find port usage with `netstat -ano | Select-String ":3001"`

## Project Stack
- **Backend**: Node.js + Express (`HerdHub/server.js`), ESM (`import`/`export`)
- **Frontend**: React 19 + Vite + MUI v7 (`HerdHub/src/App.jsx`)
- **Auth**: `bcryptjs` + `express-session` (7-day cookies), NO passport/Google
- **Storage**: Flat JSON files on disk (no database)

## Architecture
- Express runs on port **3001**; Vite dev server proxies `/api` to it
- Vite config: `HerdHub/vite.config.js`

## Data Layout
```
/app/HerdHub/data/          ← Railway volume (DATA_DIR env var)
  db/
    breeds.json             ← master breed list (integer id field)
    accounts.json           ← [{ id, email, passwordHash, role, createdAt }]
    users/
      <base64email>/
        myherd.json         ← full breed copies (private per user)
  images/                   ← uploaded breed images (served at /images/*)
```
- Locally defaults to `HerdHub/data/` (relative to server.js)

## Auth Roles
| Role    | Description                              |
|---------|------------------------------------------|
| `guest` | Browse All list only (no login required) |
| `user`  | + My Herd tab (save/edit private copies) |
| `admin` | + Edit master list, manage accounts      |

- Seeded admins: `pauldenhertog256@gmail.com`, `hamata25@gmail.com` (PipoPassword*)
- Self-registration is open (role defaults to `user`)

## Key API Routes
- `GET  /api/me` — returns `{ role }` or `{ email, role }`
- `POST /api/login` / `POST /api/register` / `POST /api/logout`
- `GET  /api/breeds` — public (no auth)
- `PATCH/POST/DELETE /api/breeds/*` — admin only (`requireAdmin`)
- `GET/PUT /api/myherd` — logged-in users (`requireUser`)
- `GET/PATCH/DELETE /api/accounts` — admin only

## Frontend State (App.jsx)
- `role` state: `'loading' | 'guest' | 'user' | 'admin'`
- `isAdmin = role === 'admin'`
- `isUser  = role === 'user' || role === 'admin'`
- `showLogin` state controls login page overlay
- My Herd tab and bookmark toggle redirect guests to login

## Dev Ports
| Service          | Port  |
|------------------|-------|
| Express API      | 3001  |
| Vite (HerdHub)   | 5175  |

Other dev servers the user runs start at 5176 and count up.

## Dev Workflow
```powershell
# Terminal 1 — backend
cd HerdHub; node server.js

# Terminal 2 — frontend
cd HerdHub; npm run dev
# → always http://localhost:5175/
```
