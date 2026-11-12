# Scripts

Run from the repo root. Most have a `pnpm` script; the rest are run with `node scripts/<folder>/<file>`.

A script's tests sit beside it as `<name>.test.mjs`. `pnpm test:scripts` runs them all, offline; CI runs it too.

## `develop/`

| Script                                  | Run                                              | Does                                                                                                                |
| --------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `dev-provider.mjs`, `dev-personas.json` | `pnpm dev:local` / `dev:supabase` / `dev:header` | The Selva app pinned to one auth provider on throwaway data ([DEV-PROVIDERS.md](./develop/DEV-PROVIDERS.md))        |
| `sync-shared-assets.js`                 | from `plugin-ui` and `ui` builds                 | Copies `assets/shared/` into each package's `static/`                                                               |
| `check-fixtures.mjs`                    | `pnpm check:fixtures`; CI                        | Fails on an unlisted or misnamed file in `dev/` or `examples/`                                                      |
| `clean.js`                              | `pnpm clean`                                     | Removes `node_modules`, build output and the lockfile                                                               |
| `solve-bench/`                          | `node scripts/develop/solve-bench/<tool>.mjs`    | Captures and times solves from Grasshopper to the browser's first frame ([README](./develop/solve-bench/README.md)) |

## `plugin/`

| Script                           | Run                                                  | Does                                                                                                                           |
| -------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `build-production.js`            | `pnpm build:plugin`                                  | Embeds the plugin UI into `Selva.gha`, builds both TFMs and the yak packages; `--with-app` adds the Selva app and `SelvaSetup` |
| `make-app-icon.mjs`              | `node scripts/plugin/make-app-icon.mjs`              | Draws `Plugin/Selva.App/selva.ico` from the SVG logo; rerun when the logo changes                                              |
| `build-mac-app.mjs`              | `pnpm build:app:mac`                                 | Builds `Plugin/Selva.App.Mac/bin/Selva.app`, universal and signed ad hoc; macOS only                                           |
| `install-local.js`               | `pnpm install:plugin`                                | Builds and installs into Rhino 8's and 9's package folders                                                                     |
| `check-component-signatures.mjs` | CI; `--update` after a param change                  | Fails on a changed param list behind an existing component GUID, or any change in `OBSOLETE/`                                  |
| `bridge-drive.mjs`               | `node scripts/plugin/bridge-drive.mjs <url> <steps>` | Drives a running UI Bridge from outside Rhino and logs every frame with timings                                                |
| `snap-preview.mjs`               | `node scripts/plugin/snap-preview.mjs --url <url>`   | Screenshots the preview page: each form tab, the 3D view per look, per set of input values                                     |
| `perf-report.mjs`                | `node scripts/plugin/perf-report.mjs <log>`          | Summarises a `SELVA_PERF_LOG` file                                                                                             |
| `example-definitions/`           | in Rhino, see its README                             | Builds the showcase and stress-test `.gh` files                                                                                |
| `compute-deploy.mjs`             | `pnpm compute:deploy`                                | Deploys or inspects Selva's own Rhino.Compute server                                                                           |

## `release/`

| Script                                                     | Run                         | Does                                                                                     |
| ---------------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------- |
| `publishable-packages.mjs`                                 | imported; CI                | The workspace packages that publish to npm                                               |
| `validate-changesets.mjs`                                  | pre-commit hook; CI         | Rejects a changeset that names an unknown package, or mixes ignored and publishable ones |
| `check-changesets.mjs`, `changed-publishable-packages.mjs` | CI                          | A change to a publishable package needs a changeset                                      |
| `unconsumed-changesets.mjs`                                | release workflow            | Lists changesets the current pre-release has not consumed                                |
| `verify-pack.mjs`                                          | `pnpm test:pack`; `release` | Packs every publishable package and checks what would ship                               |
| `changeset-publish.mjs`                                    | `pnpm release`              | `changeset publish` that passes when npm already has every version                       |
| `release-plugin.js`, `plugin-changelog.mjs`                | `pnpm release:plugin`; CI   | Cuts a plugin version and its `Plugin/CHANGELOG.md` section                              |

`release/` is an exception in `.gitignore`: the .NET rule `[Rr]elease/` would ignore it.
