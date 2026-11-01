---
'@selvajs/platform': minor
'@selvajs/local-provider': patch
'@selvajs/supabase-provider': patch
'@selvajs/server': minor
'@selvajs/selva': patch
---

Image uploads have limits, stored images match the docs, and deleted orgs and projects take their blobs with them.

- `transcodeImageIfNeeded` refuses more than 60 MP, stops after 10 seconds, runs two at a time and checks the real format, so a small upload can no longer eat gigabytes or seconds of CPU. SVG has to be declared as SVG. Anything it won't process throws `ProviderError(422)` rather than a 500.
- Stored images apply EXIF orientation and fit within 1200px on both sides, not only the width.
- A declared content type now beats the file extension: a PDF named `x.png` is stored as a PDF.
- `IStorageProvider.put`'s doc now states that images are stored as WebP at a rewritten path, as part of the contract.
- `deletePrefix` refuses an empty prefix and `/` on both providers, and the Supabase listing pages past 1000 entries.
- `SupabaseStorageProvider` keeps any unclassified path in the private bucket.
- `GuidSchema` lowercases, so one GUID can't become two records on local.
- The `definition-cover` class matches `cover.webp` only, and the unused `org-private` class is gone, along with its branch in `/api/files`. `orgPaths.privateAsset` is deprecated.
- `deleteProjectWithBlobs` and `deleteOrgWithBlobs` in `@selvajs/server/projects` wipe blobs on delete, and every delete route uses them.
