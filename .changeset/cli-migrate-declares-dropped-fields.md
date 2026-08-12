---
'@selvajs/cli': patch
---

`selva migrate` now shows every field it discards, and keeps `engines`.

The rewrite replaces a deployment's `package.json` wholesale, which is deliberate — the directory is generated output. But the confirmation prompt only diffed `dependencies` and `scripts`, so `devDependencies`, `description`, and any other top-level field the operator had added disappeared without ever being shown. The diff now lists them, so a confirmed migration has no unadvertised losses. `selva doctor` was quiet about them too: `detectDrift` reported "layout is current" on a deployment `migrate` would strip.

`engines` is now carried over rather than dropped. npm only enforces it under `engine-strict`, so an operator who pinned a Node floor did it deliberately — and removing it takes away a guard whose absence surfaces only under real traffic (the failure mode behind issue #176).
