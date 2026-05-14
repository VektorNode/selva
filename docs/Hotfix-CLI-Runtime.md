# Hotfixing `@selvajs/selva` and `@selvajs/cli`

Use this only for a fast live hotfix. Normal releases should still go through [Publishing.md](./Publishing.md).

Flow: **bump → build if runtime changed → verify → publish with pnpm → operator updates**.

## When to use this

- One small runtime or CLI fix.
- Provider changes also count as runtime hotfixes because they ship through `@selvajs/selva`.

Do not use this for coordinated multi-package releases.

## `@selvajs/create` → `@selvajs/cli`

Existing deployments using `@selvajs/create` should migrate once:

```bash
cd ~/apps/selva
npm uninstall @selvajs/create
npm install @selvajs/cli
selva restart
```

Before announcing the migration, check for hard-coded old paths:

```bash
grep -r "@selvajs/create" ~/apps/selva
```

## Runtime hotfix

Use for changes in `packages/selva/**`, `packages/providers/**`, or Selva runtime templates/scripts.

```bash
node -e "const f='packages/selva/package.json';const p=require('./'+f);const [a,b,c]=p.version.split('.').map(Number);p.version=\`\${a}.\${b}.\${c+1}\`;require('fs').writeFileSync(f,JSON.stringify(p,null,'\t')+'\n');console.log(p.version)"

pnpm --filter @selvajs/selva run build

grep -rl "<distinctive string from your fix>" packages/selva/build \
  || { echo "fix not in build — ABORT"; exit 1; }

pnpm --filter @selvajs/selva publish --access public --no-git-checks

npm view @selvajs/selva version
npm view @selvajs/selva@latest dependencies
```

If the bundle check misses your fix, rebuild with:

```bash
pnpm --filter @selvajs/selva run build --force
```

## CLI hotfix

Use for changes in `packages/cli/**`.

```bash
node -e "const f='packages/cli/package.json';const p=require('./'+f);const [a,b,c]=p.version.split('.').map(Number);p.version=\`\${a}.\${b}.\${c+1}\`;require('fs').writeFileSync(f,JSON.stringify(p,null,'\t')+'\n');console.log(p.version)"

node --input-type=module -e "for (const m of ['./packages/cli/src/cli.js','./packages/cli/src/prompts.js','./packages/cli/src/commands/create.js','./packages/cli/src/commands/init.js','./packages/cli/src/commands/doctor.js','./packages/cli/src/commands/pm2.js','./packages/cli/src/commands/migrate.js','./packages/cli/src/commands/keys.js']) { await import(m); console.log('ok',m); }"

pnpm --filter @selvajs/cli publish --access public --no-git-checks
npm view @selvajs/cli version
```

If the fix touches `bin/` or CLI packaging, also test a packed tarball before publishing.

## Combined hotfix

If both runtime and CLI changed, publish runtime first:

```bash
for pkg in selva cli; do
  node -e "const f='packages/$pkg/package.json';const p=require('./'+f);const [a,b,c]=p.version.split('.').map(Number);p.version=\`\${a}.\${b}.\${c+1}\`;require('fs').writeFileSync(f,JSON.stringify(p,null,'\t')+'\n');console.log('$pkg',p.version)"
done

pnpm --filter @selvajs/selva run build
node --input-type=module -e "await import('./packages/cli/src/cli.js'); console.log('ok')"

pnpm --filter @selvajs/selva publish --access public --no-git-checks
pnpm --filter @selvajs/cli publish --access public --no-git-checks
```

## Two traps

### Never use `npm publish`

Always publish Selva packages with `pnpm publish`. `npm publish` can ship literal `workspace:*` and `catalog:` dependency specs and break installs.

If that happens and the version is still within npm's unpublish window, unpublish, bump, and republish.

### npm cache can hide your new version

Operators can run `npm update` and still get the old package if npm's cached packument is stale.

Recovery on the VM:

```bash
cd ~/apps/selva
npm cache clean --force
rm -rf node_modules package-lock.json
npm install --prefer-online
npm run restart
node -e "console.log(require('./node_modules/@selvajs/selva/package.json').version)"
```

Quick diagnosis:

1. Check what `selva update` reported before and after.
2. Check `npm view @selvajs/selva version` locally.
3. Check the installed version on the VM.

## Operator update path

After publish, operators usually run `cd ~/apps/selva && npm run update` or use the admin update button. If the bug is in the update path itself, have them install the fixed package directly.

## Common failures

- `cannot publish over previously published version`: forgot to bump.
- `You do not have permission to publish`: verify `npm whoami` and org access.
- Fix missing from `packages/selva/build/`: rebuild with `--force`.
- `pnpm publish` blocks on a dirty tree: use `--no-git-checks` for this workflow.
- Operator still on the old version after update: clear npm cache and reinstall.
