# Access Control Overview

> `platform_admin` implies **all** permissions below it.

---

## Permissions → Admin Pages

| Page | `platform_admin` | `manage_users` | `manage_compute` | `manage_definitions` | `manage_projects` |
|------|:---:|:---:|:---:|:---:|:---:|
| `/admin` (dashboard) | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/admin/definitions` | ✅ | — | — | ✅ | — |
| `/admin/projects`    | ✅ | — | — | — | ✅ |
| `/admin/users`       | ✅ | ✅ | — | — | — |
| `/admin/compute`     | ✅ | — | ✅ | — | — |
| Update section (dashboard) | ✅ | — | — | — | — |

> Denied → redirects to `/admin`.

---

## Permissions → API Routes

| API Route | Method | `platform_admin` | `manage_users` | `manage_compute` | `manage_definitions` | `manage_projects` | Extra check |
|-----------|--------|:---:|:---:|:---:|:---:|:---:|---|
| `/admin/api/definitions` | GET | ✅ | — | — | ✅ | — | — |
| `/admin/api/definitions` | POST | ✅ | — | — | ✅ | — | `canEditDefinition` |
| `/admin/api/definitions/upload` | POST | ✅ | — | — | ✅ | — | `canEditDefinition` |
| `/admin/api/definitions/[guid]` | PATCH | ✅ | — | — | ✅ | — | `canEditDefinition` |
| `/admin/api/definitions/[guid]/image` | PUT | ✅ | — | — | ✅ | — | `canEditDefinition` |
| `/admin/api/definitions/[guid]/revert` | POST | ✅ | — | — | ✅ | — | `canEditDefinition` |
| `/admin/api/definitions/[guid]` | DELETE | ✅ | — | — | ✅ | — | `canEditDefinition` |
| `/admin/api/files` | GET | ✅ | — | — | ✅ | — | — |
| `/admin/api/projects` | GET | ✅ | — | — | — | ✅ | — |
| `/admin/api/projects/[id]` | PATCH | ✅ | — | — | — | ✅ | `canEditProjectSettings` |
| `/admin/api/projects/[id]` | DELETE | ✅ | — | — | — | ✅ | `canManage` |
| `/admin/api/projects/[id]/members` | * | ✅ | — | — | — | ✅ | — |
| `/admin/api/users` | * | ✅ | ✅ | — | — | — | — |
| `/admin/api/compute` | * | ✅ | — | ✅ | — | — | — |
| `/admin/api/compute/status` | GET | ✅ | — | ✅ | — | — | — |
| `/admin/api/update` | POST | ✅ | — | — | — | — | — |

> Denied → returns **403**.

---

## Public Routes

### `/app` — View and solve definitions

| Project type | Who can access | Rule | Error |
|---|---|---|---|
| **Public** | Any authenticated user | Logged-in users can view and solve | 401 if not authenticated |
| **Org** | Organization members only | Users belonging to the org can solve | 403 if not an org member |
| **Private** | Project members only | Only members (owner/editor/viewer) can access | 403 if not a project member |

> Denied → returns **401** (not authenticated) or **403** (authenticated but no access).

**Error messages:**
- `401 Unauthorized` — User is not authenticated
- `403 Forbidden: Not an organization member` — User is authenticated but not in the org
- `403 Forbidden: Not a project member` — User is authenticated but not a member of this project

---

## Project-level checks

These run **after** the permission check above, on routes marked with an extra check.

### `canEditDefinition(projectId, userId, definitionOwnerId)` — can upload/edit/delete definitions

Ownership-based access control depending on project visibility.

| Project type | Who can edit | Rule |
|---|---|---|
| **Public** | Definition owner only | Only the person who uploaded it can modify it |
| **Org** | Definition owner OR project member (owner/editor) | The uploader can always edit, or any project member (with proper role) |
| **Private** | Project member (owner/editor) | Standard project membership check—no special owner privileges |

> **Key:** Definition ownership provides special privileges in **public** and **org** projects, but not in **private** projects where project membership is the gatekeeper.

### `canEditProjectSettings(projectId)` — can edit project name, description, visibility

| Who | Allowed |
|-----|:---:|
| `platform_admin` | ✅ |
| Project member with role `owner` | ✅ |
| Project member with role `editor` + `manage_definitions` permission | ✅ |
| Anyone else | ❌ |

### `canManage(projectId)` — can delete project and manage members

| Who | Allowed |
|-----|:---:|
| `platform_admin` | ✅ |
| Project member with role `owner` | ✅ |
| Anyone else | ❌ |

---

## Permission scope details

### `manage_projects` — what can they actually do?

| Action | Scope |
|--------|-------|
| **List projects** | ✅ All projects in all orgs |
| **Edit project settings** (name, description, visibility) | ✅ If project `owner`, or if `editor` with `manage_definitions` permission |
| **Delete project** | ❌ Only if project `owner` |
| **Manage members** | ✅ All projects in all orgs (add/remove/change role) |

> **Key:** `manage_projects` alone doesn't let you edit projects. You need to be a project member. With `manage_definitions` + `editor` role, you can edit settings but not delete.

### `manage_definitions` — what can they actually do?

| Action | Scope |
|--------|-------|
| **List definitions** | ✅ All definitions |
| **Upload definition** | ✅ **Public/Org projects**: any org member (no project membership needed). **Private projects**: must be a project member |
| **Edit/Delete own definitions** | ✅ In **public** and **org** projects (owner privileges) |
| **Edit/Delete others' definitions** | ✅ In **private** projects + **org** projects as project member (owner/editor role) |
| **Edit/Delete others' definitions** | ❌ In **public** projects (only your own) |

**Example scenarios:**

- **Public project, not a member** → Can upload new definitions (become owner), can only edit your own
- **Org project, not a member** → Can upload new definitions (org membership sufficient), can edit/delete your own, cannot edit others'
- **Org project, member (editor)** → Can upload, can edit/delete your own AND others' definitions in the project
- **Private project, not a member** → Cannot upload (project membership required)
- **Private project, member (editor)** → Can upload, standard member access—project membership is the gate

> **Key:** Definition ownership provides special privileges in **public** (full isolation) and **org** (owner can manage own definitions) projects. In **private** projects, project membership is the only gate—no owner privileges matter.

---

## Ownership hierarchy

### Definition owner vs Project owner

| Scenario | Definition owner | Project owner | Can definition owner edit? |
|----------|:---:|:---:|---|
| **Public project** — definition owner NOT a member | ✅ (uploaded it) | — | ✅ Yes (ownership privilege) |
| **Public project** — definition owner IS a member | ✅ (uploaded it) | — | ✅ Yes (both roles apply) |
| **Org project** — definition owner NOT a member | ✅ (uploaded it) | — | ✅ Yes (ownership privilege) |
| **Org project** — definition owner IS a member | ✅ (uploaded it) | — | ✅ Yes (both roles apply) |
| **Private project** — definition owner NOT a member | ✅ (uploaded it) | — | ❌ No (not a project member) |
| **Private project** — definition owner IS a member | ✅ (uploaded it) | — | ✅ Yes (project member) |

### Key insight

- **Project owner** = controls access, settings, and membership; can edit all definitions in the project (any project type)
- **Definition owner** = the person who uploaded the definition
- **In public/org projects**: Definition owner can always edit their own definition, even if not a project member
- **In private projects**: Must be a project member to edit anything (definition ownership doesn't grant access)
- **Project owner vs Definition owner**: Project owner has broader control but definition owner has isolation in public projects

**Real example:**

- Alice uploads `scheme-v1.gh` to a **public project** she's not a member of → Alice becomes definition owner
- Bob is the project owner but **cannot edit** Alice's definition (in public projects, uploader has full isolation)
- Charlie is a project member (editor) but also **cannot edit** Alice's definition (in public projects, only uploader can)
- Alice **can always edit** her own definition, even though she's not a project member
