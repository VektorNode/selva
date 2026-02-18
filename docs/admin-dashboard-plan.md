# Admin Dashboard Plan

## Context

The compute-app runs on a Linux server. Currently any file changes (uploading .gh definitions, editing metadata, running updates) require SSH access and manual IT intervention. We need a simple web dashboard inside the compute-app itself so authorized users can manage files and trigger app updates without SSH.

Single shared password — everyone with access gets everything (no role split).

---

## Approach: `/admin` route inside compute-app

A protected `/admin` route secured by a single shared password (env var). Session stored as a signed cookie. No DB, no user accounts. Easily swappable for a proper auth library later since auth is isolated to one helper file.

### New environment variables (add to `.env`)

```
ADMIN_PASSWORD=changeme         # Plaintext password checked on login
ADMIN_SECRET=random-32-chars    # Signs the session cookie
```

---

## Files to Create

### Auth helper

- **`src/lib/server/admin-auth.server.ts`**
  Shared helper with `verifySession(cookies)`, `createSession(cookies)`, `destroySession(cookies)`.
  Signs/verifies cookie using Node's `crypto.createHmac` with `ADMIN_SECRET`.

### Routes

| File                                                | Purpose                                                                    |
| --------------------------------------------------- | -------------------------------------------------------------------------- |
| `src/routes/admin/+layout.server.ts`                | Auth guard — checks session cookie, redirects to `/admin/login` if not set |
| `src/routes/admin/login/+page.svelte`               | Simple login form (password + submit)                                      |
| `src/routes/admin/login/+page.server.ts`            | Check password, set cookie, redirect                                       |
| `src/routes/admin/+page.svelte`                     | Main dashboard: Files, Metadata editor, Update trigger                     |
| `src/routes/admin/+page.server.ts`                  | Load: reads file list + definitions-config.json                            |
| `src/routes/admin/api/files/+server.ts`             | GET list / POST upload / DELETE file                                       |
| `src/routes/admin/api/config/+server.ts`            | GET / PUT definitions-config.json                                          |
| `src/routes/admin/api/update/+server.ts`            | POST — spawns `update.sh`, streams output via SSE                          |
| `src/routes/admin/api/images/[filename]/+server.ts` | Serve uploaded images from definitions dir                                 |

---

## Dashboard Sections

### Files

- List all `.gh`, `.ghx`, and image files in `GH_DEFINITIONS_PATH`
- Upload new file (multipart form)
- Delete file by name

### Metadata editor

- Inline form per definition entry in `definitions-config.json`
- Fields: displayName, description, category, tags, coverImage
- Cover images stored as `/admin/api/images/filename.jpg` (served from definitions dir, not committed to git)
- Save writes the full JSON back to file

### Update

- "Run Update" button → `POST /admin/api/update`
- Spawns `bash update.sh` in `INSTALL_DIR`
- Streams stdout/stderr via Server-Sent Events
- Live log output in a `<pre>` box
- Shows exit code when done

---

## Auth Flow

1. Visit `/admin` → layout guard checks cookie → not set → redirect `/admin/login`
2. Submit password → matches `ADMIN_PASSWORD` → set `admin_session=<hmac-signed-token>` cookie (httpOnly, sameSite=strict)
3. Every admin request → layout guard validates HMAC → pass through
4. Logout button → clear cookie → redirect to login

---

## What stays outside git

- `.gh` / `.ghx` files live in `GH_DEFINITIONS_PATH` on the server (outside repo)
- `definitions-config.json` lives in `GH_DEFINITIONS_PATH` (outside repo)
- Uploaded images live in `GH_DEFINITIONS_PATH` (outside repo)
- `ADMIN_PASSWORD` and `ADMIN_SECRET` are env vars

Nothing new gets committed to git.

---

## Future-proofing

Auth is isolated to `admin-auth.server.ts` — swap it for Lucia/Better Auth/etc. by replacing that one file and updating the layout guard. Routes don't care how auth works internally.

Metadata storage is isolated to the `/api/config` endpoint — swap for a DB later without touching the UI.

---

## Verification

1. Add `ADMIN_PASSWORD=test` and `ADMIN_SECRET=abc123` to `.env`
2. `pnpm dev` → visit `http://localhost:5173/admin`
3. Should redirect to `/admin/login`
4. Login with `test` → should reach dashboard
5. Upload a `.gh` file → appears in file list and definitions dir
6. Edit metadata → save → check `definitions-config.json` updated
7. Wrong password → error shown, no cookie set
8. Trigger update → streams `update.sh` output live
