# Hotfixing `@selvajs/runtime` and `@selvajs/create`

The "I changed code, get it on the VM now" loop. Bypasses the changesets workflow described in [Publishing.md](./Publishing.md) — use this when you need to ship one fix to one or two operators, not cut a coordinated release.

For multi-package, multi-changeset releases use the standard flow. This doc covers the common cases:

- Changed the runtime (compute-app source, providers, the admin update handler, …) and need to republish `@selvajs/runtime`.
- Changed the CLI source under `packages/create/` and need to republish `@selvajs/create`.
- Both at once.

The shape is always: **bump → build (runtime only) → verify → publish → operator updates**.

---

## When NOT to use this

- **Coordinated multi-package release.** Use `pnpm changeset` and `pnpm release` (see Publishing.md). Changesets writes CHANGELOGs, bumps interdependent versions consistently, and publishes everything in one shot.
- **Provider-only fix** that the runtime should also pick up. Bump the provider via changeset; `updateInternalDependencies: patch` cascades a runtime bump automatically.
- **First publish of a new package.** Walk through Publishing.md's first-publish checklist (namespace check, dry-run pack, etc.).

---

## Runtime hotfix

### When this applies

Any change in:

- `packages/compute-app/**` (the bundled SvelteKit app)
- `packages/platform/**`, `packages/local-provider/**`, `packages/supabase-provider/**`, `packages/header-auth-provider/**` (the providers — if you only touched these, you can usually update them independently, but bundling a runtime release together is simpler when the change is small)
- `packages/runtime/scripts/build.js` or `packages/runtime/templates/**`

The runtime is the only publishable package that **bundles a prebuilt artifact**. Every other `@selvajs/*` package ships source; the runtime ships compiled output. Skipping the build is the most common foot-gun.

### Steps

All commands run from the repo root (`d:/Coding/selva`).

```bash
# 1. Bump the runtime version.
#    Single-package hotfixes use patch bumps. If you're shipping a breaking
#    change, use changesets — the hotfix loop is for fixes, not features.
node -e "
const fs = require('fs');
const f = 'packages/runtime/package.json';
const p = JSON.parse(fs.readFileSync(f));
const [maj, min, patch] = p.version.split('.').map(Number);
p.version = \`\${maj}.\${min}.\${patch + 1}\`;
fs.writeFileSync(f, JSON.stringify(p, null, '\t') + '\n');
console.log('bumped to', p.version);
"

# 2. Rebuild. This compiles compute-app with ADAPTER=node, copies the build
#    into packages/runtime/build/, recompiles selva.config.ts to the JS
#    template, and writes the .env.example + ecosystem.config.cjs templates.
#    Slow (~30–60s) — let it finish.
pnpm --filter @selvajs/runtime run build

# 3. Verify the fix is actually in the bundle BEFORE publishing.
#    See "Verifying the bundle" below.
grep -rl "<a distinctive string from your fix>" packages/runtime/build \
  || { echo "fix not in build — ABORT"; exit 1; }

# 4. Publish via PNPM (not npm — see "The npm-publish trap" below).
pnpm --filter @selvajs/runtime publish --access public --no-git-checks

# 5. Confirm the registry has it and the manifest is clean.
npm view @selvajs/runtime version
npm view @selvajs/runtime@latest dependencies
#   Expect: concrete version ranges. No "workspace:*", no "catalog:".
```

### Verifying the bundle

Step 3's grep is critical because **the build can succeed without your changes being baked in** — Vite caches aggressively and Turborepo's build cache layered on top can serve stale output.

Pick a string from your fix that's unlikely to appear elsewhere and isn't a JavaScript identifier (Vite renames identifiers; it preserves string literals verbatim).

Good targets:

- A literal log message: `'Update mode: '`, `'selva-compute --update-env'`
- A literal URL or path: `'/api/system/update'`, `'header-allowlist.json'`
- A literal error message: `"Couldn't determine how to update"`

Bad targets:

- Function names — `pickAuth`, `runUpdate` — Vite minifies these to single letters.
- Variable names — `plan.cmd`, `installDir` — same problem.
- TypeScript types — stripped entirely.

If the grep returns nothing despite a successful build, force-rebuild:

```bash
pnpm --filter @selvajs/compute-app run build --force
pnpm --filter @selvajs/runtime run build
```

### After publishing

Operators on the VM pick up the fix with:

```bash
cd ~/apps/selva
npm run update         # OR ./node_modules/.bin/selva update
```

This runs `npm update --save @selvajs/* && pm2 restart selva-compute --update-env`. The admin-center "Run Update" button does the same thing.

For the very first time after the runtime ships a fix to the admin-update handler itself, the CLI path is the only path — operators can't use the admin button to install a fix to the admin button.

---

## CLI hotfix

### When this applies

Any change in `packages/create/**`. The CLI is plain JavaScript shipped verbatim — there's no build step.

### Steps

```bash
# 1. Bump.
node -e "
const fs = require('fs');
const f = 'packages/create/package.json';
const p = JSON.parse(fs.readFileSync(f));
const [maj, min, patch] = p.version.split('.').map(Number);
p.version = \`\${maj}.\${min}.\${patch + 1}\`;
fs.writeFileSync(f, JSON.stringify(p, null, '\t') + '\n');
console.log('bumped to', p.version);
"

# 2. Smoke-test imports. The CLI has no type-check (it's plain .js).
#    Catches missing imports / syntax errors before they reach operators.
node --input-type=module -e "
for (const m of [
  './packages/create/src/cli.js',
  './packages/create/src/prompts.js',
  './packages/create/src/commands/create.js',
  './packages/create/src/commands/init.js',
  './packages/create/src/commands/doctor.js',
  './packages/create/src/commands/pm2.js',
  './packages/create/src/commands/keys.js'
]) { await import(m); console.log('ok', m); }
"

# 3. (Optional) Pack and install the tarball to verify bins work.
#    Recommended for any change that touches package.json or the bin/ scripts.
cd packages/create && pnpm pack
tmp=$(mktemp -d) && cd "$tmp" && npm init -y --silent >/dev/null
npm install /d/Coding/selva/packages/create/selvajs-create-<version>.tgz
node node_modules/@selvajs/create/bin/selva.js --version
node node_modules/@selvajs/create/bin/create.js   # should print Usage line
cd - >/dev/null

# 4. Publish.
pnpm --filter @selvajs/create publish --access public --no-git-checks

# 5. Confirm.
npm view @selvajs/create version
npm view @selvajs/create@latest bin
#   Expect: { create: './bin/create.js', selva: './bin/selva.js' }
```

### After publishing

CLI fixes reach operators when they next run `npm run update`, because `@selvajs/create` is in the package list that gets `npm update`d. **But:** the running CLI binary on the VM is whichever version got installed at scaffold time. The new CLI runs only on the *next* update after this one. Most CLI fixes are forward-compatible (they affect prompts, doctor checks, scaffold output) — operators who already have a deployment usually don't care.

If a CLI fix affects an existing operator's day-to-day operations (e.g. `selva update` itself is broken), they need to install it directly:

```bash
cd ~/apps/selva
npm install --save @selvajs/create@latest
./node_modules/.bin/selva ...
```

---

## Combined hotfix (runtime + CLI)

When the same fix needs both packages bumped (e.g. you added a new env var to the runtime AND a new prompt in the CLI):

```bash
# Bump both.
for pkg in runtime create; do
  node -e "
    const fs = require('fs');
    const f = 'packages/$pkg/package.json';
    const p = JSON.parse(fs.readFileSync(f));
    const [maj, min, patch] = p.version.split('.').map(Number);
    p.version = \`\${maj}.\${min}.\${patch + 1}\`;
    fs.writeFileSync(f, JSON.stringify(p, null, '\t') + '\n');
    console.log('$pkg →', p.version);
  "
done

# Build runtime, smoke-test CLI.
pnpm --filter @selvajs/runtime run build
node --input-type=module -e "await import('./packages/create/src/cli.js'); console.log('ok')"

# Publish runtime FIRST so the CLI's scaffold output references a runtime
# version that actually exists on the registry.
pnpm --filter @selvajs/runtime publish --access public --no-git-checks
pnpm --filter @selvajs/create publish --access public --no-git-checks
```

The CLI scaffolds with `"@selvajs/runtime": "latest"` so the order matters less than it seems — `npm install` resolves `latest` at install time. But publishing the runtime first means there's no window where a fresh scaffold can pick up a CLI that expects a runtime that isn't yet available.

---

## The npm-publish trap

**Never run `npm publish` on a Selva package.** Use `pnpm publish` (or `pnpm --filter ... publish`).

`@selvajs/runtime@0.10.2` was published with `npm publish` and immediately broke every install. The reason: the source `package.json` has `workspace:*` and `catalog:` specs for its internal deps. `pnpm publish` rewrites those to real version ranges at pack time. `npm publish` does not — it ships the literal strings. The published tarball contained `"@selvajs/local-provider": "workspace:*"`, and `npm install` died silently because it can't resolve `workspace:*`.

The failure mode is **silent in npm logs** — `npm install` logs the manifest fetch, then exits 1 with no error printed. The only diagnosis is `npm view @selvajs/runtime@<version> dependencies` and noticing the literal `workspace:*` strings.

To prevent this entirely, the runtime build script should hand-flatten specs before publish so it works with either tool. That's a TODO — see [WhiteLabelPlan.md](./WhiteLabelPlan.md). Until then, the habit of typing `pnpm publish` is the only line of defence.

### If you publish a broken version

```bash
# Within 72h of publish, you can unpublish.
npm unpublish @selvajs/<pkg>@<broken-version>
npm view @selvajs/<pkg> versions    # confirm gone
npm view @selvajs/<pkg> dist-tags   # confirm latest rolled back

# Bump to a new patch version, publish properly, and warn anyone with the
# broken version cached.
```

Operators who already pulled the broken version are stuck because npm caches manifests for ~5 minutes. They need:

```bash
npm cache clean --force
cd ~/apps/selva
rm -rf node_modules package-lock.json
npm install --prefer-online
```

---

## The stale-packument-cache trap

The single most common reason a hotfix "doesn't reach the operator" — and it has nothing to do with your publish. **It's a known footgun of npm itself**, but worth understanding because every operator hits it at least once.

### Mechanism

When the VM runs `npm update @selvajs/runtime`, npm doesn't go straight to the registry. It:

1. Looks for a cached **packument** (the JSON document listing every version + dist-tags for the package) in `~/.npm/_cacache/`.
2. If the cache entry is fresh (default TTL ~5 minutes, sometimes longer depending on `Cache-Control` headers from the registry), npm uses it without revalidating.
3. The cached packument may have been fetched **before your publish**. It says `latest = 0.10.3`. npm installs `0.10.3`. No error, no warning.

The operator sees `selva update` complete successfully — same "before" and "after" version, no diff. They assume they got the fix. They didn't.

### What you'll see

If you've just published `@selvajs/runtime@0.10.4`:

- **Your machine (the publisher's):** `npm view @selvajs/runtime version` → `0.10.4`. The publish worked.
- **Operator's VM:** `selva update` → `Current: 0.10.3` → `New: 0.10.3`. Cache served stale.

This is **not** the same as `npm publish` shipping `workspace:*` (that's the "npm-publish trap" above and breaks installs outright). Stale-packument is silent — the VM just stays on the old version.

### What an operator can do right now

```bash
cd ~/apps/selva
npm cache clean --force
rm -rf node_modules package-lock.json
npm install --prefer-online
npm run restart

# Verify
node -e "console.log(require('./node_modules/@selvajs/runtime/package.json').version)"
```

`--prefer-online` forces npm to revalidate every cached manifest against the registry before trusting it.

This is documented for operators in [deployment/GCE-Linux.md](./deployment/GCE-Linux.md)'s "npm run update reports success but the version didn't change" entry.

### What we should do about it

The trap exists in `selva update` and the admin handler today. Three layered fixes will close it:

1. **Pass `--prefer-online` in `selva update` and the admin handler.** One-line change in [packages/create/src/commands/pm2.js](../packages/create/src/commands/pm2.js) and [packages/compute-app/src/routes/admin/api/system/update/+server.ts](../packages/compute-app/src/routes/admin/api/system/update/+server.ts). Adds a HEAD request per package — negligible cost, guaranteed fresh.

2. **Compare versions before / after and warn loudly when nothing changed.** Today the CLI prints `Current: 0.10.3 → New: 0.10.3` and exits successfully. It should detect the no-op and surface it:

   ```
   ! No packages updated. Already on latest (according to your npm cache).
     If you expected a new version, your cache may be stale.
     Recover: npm cache clean --force && npm install --prefer-online
   ```

3. **Switch to `npm install @selvajs/<pkg>@latest` instead of `npm update`.** `install @latest` resolves the dist-tag against the registry every time, regardless of cache. Heavier than `update` (touches more of the dep tree), but bulletproof. Use as a fallback if `--prefer-online` still under-performs in practice.

When you do the next hotfix to the CLI / runtime, bundle these in. The TODO is tracked in [WhiteLabelPlan.md](./WhiteLabelPlan.md) — search for "stale-packument-cache".

### Diagnosing operator reports

When an operator says "I updated and it didn't work," the question chain is:

1. **What did `selva update` print for "Current" and "New" runtime version?** Identical → stale cache. Different → genuine update, dig elsewhere.
2. **What does `npm view @selvajs/runtime version` print on YOUR machine?** That's authoritative for what's on the registry.
3. **What does `node -e "..."` print on the VM?** That's authoritative for what's installed.

If (1) shows identical, (2) is newer than (3), it's the cache trap — recovery commands above.

---

## CHANGELOG hygiene

The hotfix loop bypasses changesets, which means CHANGELOG.md files don't get updated automatically. You have two options:

1. **Skip it.** Patch bumps don't really need CHANGELOG entries — the git history is the changelog.
2. **Hand-write it.** Edit `packages/<name>/CHANGELOG.md` with the same shape changesets uses:

   ```markdown
   ## 0.10.4

   ### Patch Changes

   - Fix shell-quoting bug in admin-update handler (sh: update: not found)
   ```

   Commit alongside the version bump. The next `pnpm changeset version` won't fight you because it appends to the existing file.

For anything bigger than a one-line fix, use changesets. They exist for a reason.

---

## Troubleshooting

### "cannot publish over previously published version"

You forgot to bump. Run the bump script and try again.

### "You do not have permission to publish @selvajs/runtime"

`npm whoami` — check you're logged in and on the `@selvajs` org.

### Build succeeds but my fix isn't in `packages/runtime/build/`

Turborepo cache. `pnpm --filter @selvajs/compute-app run build --force`, then rerun the runtime build.

### `pnpm publish` refuses because of uncommitted changes

`--no-git-checks` skips the dirty-tree check. We use it deliberately for hotfixes — committing the version bump after publish is fine because npm already has the tarball.

### Operator says `npm run update` got `@selvajs/runtime@<old-version>`

Stale-packument-cache trap. See "The stale-packument-cache trap" section above — it has the mechanism, the operator recovery commands, and the three layered fixes we plan to ship.

### Operator says the admin update button shows "update: not found"

Specifically the `sh: 1: update: not found` error — that was a bug in the admin update handler (the shell command was constructed without the `npm` prefix). Fixed in `@selvajs/runtime@0.10.4`. If you see it on a newer version, paste the SSE log output and we'll re-diagnose.
