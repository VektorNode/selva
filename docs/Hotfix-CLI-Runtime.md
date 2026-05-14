# Hotfixing `@selvajs/selva` and `@selvajs/cli`

The "ship one fix to a live VM now" loop. Bypasses the changesets workflow ([Publishing.md](./Publishing.md)) — use this for a single fix to one or two operators, not a coordinated release.

Shape is always: **bump → build (runtime only) → verify → publish → operator updates.**

## When NOT to use this

- **Coordinated multi-package release** → `pnpm changeset` + `pnpm release`.
- **Provider-only fix** → providers bundle into `@selvajs/selva`, so it's a runtime hotfix.
- **First publish of a new package** → use Publishing.md's first-publish checklist.

---

## Migrating an existing deployment from `@selvajs/create`

The CLI package was renamed `@selvajs/create` → `@selvajs/cli` in `@selvajs/selva@0.12.0+`. The package contents and bins are identical — same `selva` command, same scaffolding behavior — only the npm name changed.

**Operators with a live deployment that has `@selvajs/create` in their `package.json` need to swap it at next update.** Until they do, `npm run update` keeps installing the old `@selvajs/create` package, which still works but won't receive any further updates.

### One-time migration steps

On the VM:

```bash
cd ~/apps/selva

# 1. Drop the old name from package.json + node_modules.
npm uninstall @selvajs/create

# 2. Install the new name.
npm install @selvajs/cli

# 3. Confirm the `selva` bin still resolves and points at the new package.
which selva
#   → /…/node_modules/.bin/selva
readlink "$(which selva)"
#   → ../@selvajs/cli/bin/selva.js   (was: ../@selvajs/create/bin/selva.js)

# 4. Restart so the new code is picked up.
selva restart
```

That's it. The bin name (`selva`) is unchanged, so all scripts (`npm start`, `npm run logs`, pm2 unit, ecosystem.config.cjs, admin-update handler) keep working without edits.

### What to check before announcing

Before telling operators to migrate, verify their deployment isn't pinned to `@selvajs/create` in places `npm install` won't see:

- **`ecosystem.config.cjs`** — does it call `node_modules/@selvajs/create/bin/selva.js` directly? If so, they need to update the path to `node_modules/@selvajs/cli/bin/selva.js`. (Default scaffolds use bare `selva` from `$PATH` and don't need this fix.)
- **Custom scripts or systemd units** — anything that hard-codes the `@selvajs/create` path will break and needs updating.

`grep -r "@selvajs/create" ~/apps/selva` on the VM catches these.

### `npm view` sanity check

Before announcing the rename, confirm both names are queryable so operators don't get confused if they search for the old one:

```bash
npm view @selvajs/create       # shows last published version of the old name
npm view @selvajs/cli          # shows current published version
```

The old `@selvajs/create` package stays on npm forever (npm forbids unpublishing after 72h). It just stops receiving updates. Consider running `npm deprecate @selvajs/create "renamed to @selvajs/cli — see https://…/docs/Hotfix-CLI-Runtime.md#migrating"` once `@selvajs/cli` ships, so anyone who installs the old name sees the deprecation notice in their terminal.

---

## Runtime hotfix

Applies to changes in `packages/selva/**`, any `packages/providers/**`, or `packages/selva/scripts/build.js` / `templates/**`. The runtime is the only publishable package that ships a **prebuilt artifact** — skipping the build is the most common foot-gun.

```bash
# 1. Bump patch.
node -e "const f='packages/selva/package.json';const p=require('./'+f);const [a,b,c]=p.version.split('.').map(Number);p.version=\`\${a}.\${b}.\${c+1}\`;require('fs').writeFileSync(f,JSON.stringify(p,null,'\t')+'\n');console.log(p.version)"

# 2. Rebuild (~30–60s).
pnpm --filter @selvajs/selva run build

# 3. Verify the fix is in the bundle (see below) BEFORE publishing.
grep -rl "<distinctive string from your fix>" packages/selva/build \
  || { echo "fix not in build — ABORT"; exit 1; }

# 4. Publish via PNPM (never npm — see "npm-publish trap").
pnpm --filter @selvajs/selva publish --access public --no-git-checks

# 5. Confirm.
npm view @selvajs/selva version
npm view @selvajs/selva@latest dependencies   # expect concrete ranges, no workspace:* / catalog:
```

**Verifying the bundle.** Vite + Turborepo caches can silently serve stale output. Pick a string Vite preserves verbatim: a literal log message, URL, or error text. Avoid function/variable names (minified) and TS types (stripped). If grep returns nothing, force a rebuild: `pnpm --filter @selvajs/selva run build --force`.

**After publishing**, operators run `cd ~/apps/selva && npm run update` (or the admin "Run Update" button) which calls `npm update --save @selvajs/* && pm2 restart selva-compute --update-env`. If the fix is *to* the admin-update handler itself, the CLI path is the only path.

---

## CLI hotfix

Applies to `packages/cli/**`. Plain JS — no build step.

```bash
# 1. Bump.
node -e "const f='packages/cli/package.json';const p=require('./'+f);const [a,b,c]=p.version.split('.').map(Number);p.version=\`\${a}.\${b}.\${c+1}\`;require('fs').writeFileSync(f,JSON.stringify(p,null,'\t')+'\n');console.log(p.version)"

# 2. Smoke-test imports (no type-check exists for the CLI).
node --input-type=module -e "for (const m of ['./packages/cli/src/cli.js','./packages/cli/src/prompts.js','./packages/cli/src/commands/create.js','./packages/cli/src/commands/init.js','./packages/cli/src/commands/doctor.js','./packages/cli/src/commands/pm2.js','./packages/cli/src/commands/keys.js']) { await import(m); console.log('ok',m); }"

# 3. Publish.
pnpm --filter @selvajs/cli publish --access public --no-git-checks
npm view @selvajs/cli version
```

For changes touching `package.json` or `bin/` scripts, also `pnpm pack` + install the tarball into a temp dir and run `node node_modules/@selvajs/cli/bin/selva.js --version` first.

**After publishing**, CLI fixes reach operators via the next `npm run update` (`@selvajs/cli` is in the update set). The *running* CLI on the VM is from the previous update — new CLI runs only on the next one. If a CLI fix breaks `selva update` itself, operators must install directly: `npm install --save @selvajs/cli@latest`.

---

## Combined hotfix (runtime + CLI)

Bump both, build runtime, smoke-test CLI, **publish runtime first** so a fresh scaffold can't pick up a CLI that expects a not-yet-published runtime:

```bash
for pkg in selva cli; do
  node -e "const f='packages/$pkg/package.json';const p=require('./'+f);const [a,b,c]=p.version.split('.').map(Number);p.version=\`\${a}.\${b}.\${c+1}\`;require('fs').writeFileSync(f,JSON.stringify(p,null,'\t')+'\n');console.log('$pkg',p.version)"
done

pnpm --filter @selvajs/selva run build
node --input-type=module -e "await import('./packages/cli/src/cli.js'); console.log('ok')"

pnpm --filter @selvajs/selva publish --access public --no-git-checks
pnpm --filter @selvajs/cli   publish --access public --no-git-checks
```

---

## The npm-publish trap

**Never run `npm publish` on a Selva package — always `pnpm publish`.**

Source `package.json` files have `workspace:*` and `catalog:` specs for internal deps. `pnpm publish` rewrites these to real ranges at pack time; `npm publish` ships the literal strings. `@selvajs/selva@0.10.2` was published with `npm` and broke every install — `npm install` died silently on `"@selvajs/local-provider": "workspace:*"`. Failure mode is silent in npm logs; the only diagnosis is `npm view @selvajs/selva@<version> dependencies` and noticing the literal `workspace:*`.

**If you publish a broken version**, within 72h: `npm unpublish @selvajs/<pkg>@<version>`, bump, republish. Operators with the broken version cached need `npm cache clean --force && rm -rf node_modules package-lock.json && npm install --prefer-online`.

---

## The stale-packument-cache trap

The most common reason a hotfix "doesn't reach the operator" — and it isn't your publish.

When the VM runs `npm update`, npm checks its cached **packument** (per-package JSON listing all versions + dist-tags) before hitting the registry. Default TTL is ~5 min. If the cache was populated before your publish, npm uses it, installs the old `latest`, exits 0 — no error. The operator sees identical "before" / "after" versions and assumes success.

**Distinct from the npm-publish trap above:** that one breaks installs outright; this one silently keeps the VM on the old version.

**Operator recovery:**

```bash
cd ~/apps/selva
npm cache clean --force
rm -rf node_modules package-lock.json
npm install --prefer-online
npm run restart
node -e "console.log(require('./node_modules/@selvajs/selva/package.json').version)"  # verify
```

Also documented for operators in [deployment/GCE-Linux.md](./deployment/GCE-Linux.md).

**Planned fixes (bundle into the next CLI/runtime hotfix):**

1. Pass `--prefer-online` in `selva update` ([packages/cli/src/commands/pm2.js](../packages/cli/src/commands/pm2.js)) and the admin handler ([packages/selva/src/routes/admin/api/system/update/+server.ts](../packages/selva/src/routes/admin/api/system/update/+server.ts)).
2. Compare versions before/after; warn loudly when nothing changed.
3. Fallback to `npm install @selvajs/<pkg>@latest` if `--prefer-online` underperforms.

**Diagnosing operator reports.** When an operator says "I updated and it didn't work":

1. What did `selva update` print for Current / New? Identical → stale cache. Different → dig elsewhere.
2. `npm view @selvajs/selva version` on **your** machine — authoritative for the registry.
3. `node -e "console.log(require('./node_modules/@selvajs/selva/package.json').version)"` on the VM — authoritative for what's installed.

(1) identical and (2) > (3) → cache trap; run the recovery above.

---

## CHANGELOG and Troubleshooting

Patch-bump hotfixes can skip CHANGELOG.md — git history is the changelog. For anything bigger than a one-line fix, use changesets.

Common errors:

- **"cannot publish over previously published version"** — forgot to bump.
- **"You do not have permission to publish"** — `npm whoami`; confirm `@selvajs` org membership.
- **Build succeeds but fix isn't in `packages/selva/build/`** — Turborepo cache; `pnpm --filter @selvajs/selva run build --force`.
- **`pnpm publish` refuses uncommitted changes** — `--no-git-checks` is deliberate here; commit the bump after.
- **Operator on the old version after `npm run update`** — stale-packument-cache; see section above.
- **Admin update button: `sh: 1: update: not found`** — old bug, fixed in `@selvajs/selva@0.10.4`. Newer version? Paste the SSE log.
