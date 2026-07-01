---
'@selvajs/selva': minor
---

Organization assets & branding. Admins can now upload and manage per-org assets (including a logo) from the admin area, backed by a new asset-upload flow and org asset service. Served files are classified and gated by visibility/access-control checks on the `/api/files` route, and the owning org's logo is forwarded to the viewer as a branding watermark.
