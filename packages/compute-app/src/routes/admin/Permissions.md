# Access Control Overview

> `platform_admin` implies **all** permissions below it.

---

## Quick Reference: Permission Model

| Permission           | Scope                  | Key Role                     |
| -------------------- | ---------------------- | ---------------------------- |
| `platform_admin`     | All admin pages & APIs | Global admin (⚡ super-user) |
| `manage_users`       | User management API    | User admin                   |
| `manage_compute`     | Compute server config  | Compute admin                |
| `manage_definitions` | Definition CRUD        | Definition curator           |
| `manage_projects`    | Project & member mgmt  | Project curator              |

---

## Admin Pages Access

| Page                 | `platform_admin` | `manage_users` | `manage_compute` | `manage_definitions` | `manage_projects` |
| -------------------- | :--------------: | :------------: | :--------------: | :------------------: | :---------------: |
| `/admin` (dashboard) |        ✅        |       ✅       |        ✅        |          ✅          |        ✅         |
| `/admin/definitions` |        ✅        |       —        |        —         |          ✅          |         —         |
| `/admin/projects`    |        ✅        |       —        |        —         |          —           |        ✅         |
| `/admin/users`       |        ✅        |       ✅       |        —         |          —           |         —         |
| `/admin/compute`     |        ✅        |       —        |        ✅        |          —           |         —         |
| Update section       |        ✅        |       —        |        —         |          —           |         —         |

**Denied** → redirects to `/admin`

---

## Content API Routes

Used by `/definitions` (content dashboard). Gated by permission, not URL prefix.

| Route                            | Method | `platform_admin` | `manage_definitions` | `manage_projects` | Extra Checks             |
| -------------------------------- | ------ | :--------------: | :------------------: | :---------------: | ------------------------ |
| **Definitions**                  |
| `/api/definitions`               | POST   |        ✅        |          ✅          |         —         | `canEditDefinition`      |
| `/api/definitions/upload`        | POST   |        ✅        |          ✅          |         —         | `canEditDefinition`      |
| `/api/definitions/[guid]`        | PUT    |        ✅        |          ✅          |         —         | `canEditDefinition`      |
| `/api/definitions/[guid]`        | DELETE |        ✅        |          ✅          |         —         | `canEditDefinition`      |
| `/api/definitions/[guid]/image`  | POST   |        ✅        |          ✅          |         —         | `canEditDefinition`      |
| **Projects**                     |
| `/api/projects`                  | GET    |        ✅        |          —           |         —         | —                        |
| `/api/projects`                  | POST   |        ✅        |          —           |        ✅         | —                        |
| `/api/projects/[id]`             | PATCH  |        ✅        |          —           |        ✅         | `canEditProjectSettings` |
| `/api/projects/[id]`             | DELETE |        ✅        |          —           |         —         | `canManage`              |
| `/api/projects/[id]/members`     | \*     |        ✅        |          —           |         —         | `canManageMembers`       |

## Admin API Routes

Used by `/admin/*` pages. Genuinely admin-only.

| Route                       | Method | `platform_admin` | `manage_users` | `manage_compute` |
| --------------------------- | ------ | :--------------: | :------------: | :--------------: |
| `/admin/api/users`          | \*     |        ✅        |       ✅       |        —         |
| `/admin/api/compute`        | \*     |        ✅        |       —        |        ✅        |
| `/admin/api/compute/status` | GET    |        ✅        |       —        |        ✅        |
| `/admin/api/update`         | POST   |        ✅        |       —        |        —         |

**Denied** → returns **403**

---

## Public Routes: `/app` (View & Solve Definitions)

| Project Type | Who Can Access | Can View Schema? | Can Solve? | Can Download Results? | Error If Denied |
|---|---|:---:|:---:|:---:|---|
| **Public** | Any authenticated user | ✅ Yes | ✅ Yes | ✅ Yes | 401 Unauthorized |
| **Org** | Organization members only | ✅ Yes | ✅ Yes | ✅ Yes | 403 Forbidden: Not an org member |
| **Private** | Project members only (owner/editor/viewer) | ✅ Yes | ✅ Yes | ✅ Yes | 403 Forbidden: Not a project member |
| **Not logged in** | N/A | ❌ No | ❌ No | ❌ No | 401 Unauthorized (must log in first) |

**Access flow:**
1. User navigates to `/app?gh=definition-name.gh` or `/app?gh={guid}`
2. System checks: Is user authenticated? (401 if no)
3. System checks: Can user access the project based on visibility?
4. If granted: User can view schema and solve the definition interactively
5. If denied: User gets 403 error (see table)

**Concrete scenarios:**

| Scenario | Can Access? | Why |
|---|:---:|---|
| Alice (logged in) views **public** project | ✅ Yes | Public = any authenticated user |
| Bob (not logged in) views **public** project | ❌ No | Must be authenticated first (401) |
| Carol (org member) views **org** project | ✅ Yes | Org project = org members only |
| David (different org) views **org** project | ❌ No | Not a member of that org (403) |
| Eve (project member) views **private** project | ✅ Yes | Private project = members only |
| Frank (not a member) views **private** project | ❌ No | Not invited to project (403) |
| Grace (project owner) views **private** project | ✅ Yes | Owners are members (403) |

**Note:** All authenticated users can **upload** definitions to **public** projects (if they have `manage_definitions` permission), becoming the definition owner. This is separate from viewing/solving.

---

## Custom Access Checks (Gate Keepers)

These run **after** permission check on specific routes.

### `canEditDefinition` — Can upload/edit/delete definitions?

| Project Type | Permission + Role                                                             | Rule                                                         |
| ------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **Public**   | `manage_definitions` + definition owner                                       | Only the uploader can modify (full isolation)                |
| **Org**      | `manage_definitions` + (definition owner OR project member with owner/editor) | Uploader always can; project members with role can also edit |
| **Private**  | Project member (owner/editor)                                                 | Standard membership check (no owner privileges)              |

**Examples:**

- Alice uploads to a public project → Only Alice can edit, even project members can't
- Bob uploads to an org project → Bob can edit as definition owner; also any project member with editor or owner role can edit that definition in that project
- Carol uploads to a private project but isn't a member → Can't edit (membership is the gate)

### `canEditProjectSettings` — Can edit name, description, visibility?

| Who                                                                 | Allowed |
| ------------------------------------------------------------------- | :-----: |
| `platform_admin`                                                    |   ✅    |
| Project member with role `owner`                                    |   ✅    |
| Project member with role `editor` + `manage_definitions` permission |   ✅    |
| Anyone else                                                         |   ❌    |

### `canManage` — Can delete project & manage members?

| Who                              | Allowed |
| -------------------------------- | :-----: |
| `platform_admin`                 |   ✅    |
| Project member with role `owner` |   ✅    |
| Anyone else                      |   ❌    |

---

## What Each Permission Actually Allows

### `manage_definitions` Capability Breakdown

| Action               | Public Project                     | Org Project                   | Private Project               |
| -------------------- | ---------------------------------- | ----------------------------- | ----------------------------- |
| **List definitions** | ✅ All                             | ✅ All                        | ✅ All                        |
| **Upload**           | ✅ Any user (no membership needed) | ✅ Org members only           | ❌ Members only               |
| **Edit own**         | ✅ Definition owner privilege      | ✅ Definition owner privilege | ✅ Only if member             |
| **Edit others**      | ❌ No (full isolation)             | ✅ If project member (editor) | ✅ If project member (editor) |
| **Delete own**       | ✅ Definition owner privilege      | ✅ Definition owner privilege | ✅ Only if member             |
| **Delete others**    | ❌ No                              | ✅ If project member (editor) | ✅ If project member (editor) |

**Scenarios:**

- **Public, not member** → Upload new definitions (own them) + edit/delete your own only
- **Org, not member** → Upload new definitions (org member) + edit/delete your own only
- **Org, member (editor)** → Upload + edit/delete your own AND others' in project
- **Private, not member** → Can't upload (members only)
- **Private, member (editor)** → Standard access—project membership is the only gate

### `manage_projects` Capability Breakdown

| Action             | Allowed | Condition                                                           |
| ------------------ | :-----: | ------------------------------------------------------------------- |
| **List projects**  |   ✅    | All projects in all orgs                                            |
| **Edit settings**  |   ✅    | Must be project `owner`, OR project `editor` + `manage_definitions` |
| **Delete project** |   ❌    | Only project `owner` can delete                                     |
| **Manage members** |   ✅    | All projects (add/remove/change role)                               |

**Key:** `manage_projects` alone doesn't let you edit. You need to be a project member with proper role.

---

## Ownership vs Membership

### Definition Owner vs Project Owner

| Scenario                           | Can Definition Owner Edit? | Why                         |
| ---------------------------------- | :------------------------: | --------------------------- |
| **Public project** — not a member  |           ✅ Yes           | Ownership privilege applies |
| **Public project** — is a member   |           ✅ Yes           | Both roles apply            |
| **Org project** — not a member     |           ✅ Yes           | Ownership privilege applies |
| **Org project** — is a member      |           ✅ Yes           | Both roles apply            |
| **Private project** — not a member |           ❌ No            | Membership is the only gate |
| **Private project** — is a member  |           ✅ Yes           | Member of project           |

### Key Rules

- **Project owner** = controls access, settings, members; can edit all definitions in project (any type)
- **Definition owner** = person who uploaded the definition
- **Public/Org projects** = Definition owner can always edit their own, even if not a project member
- **Private projects** = Must be project member to edit anything (definition ownership doesn't grant access)

### Real Example: Alice, Bob, Charlie

- **Alice** uploads `scheme-v1.gh` to a **public project** she doesn't own/manage
  - Alice becomes **definition owner** of that specific definition
  - Alice **can edit/delete** her own definition (ownership privilege)
  - Bob (project owner) **cannot edit** Alice's definition (public = full isolation)
  - Charlie (project member) **cannot edit** Alice's definition (same reason)
