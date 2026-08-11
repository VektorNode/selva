---
'@selvajs/compute': major
'@selvajs/ui': minor
---

**`Sub Folder` now names the download archive, so one output can produce several zips.** This
changes what existing definitions download, without any authoring change — read the migration note
below before releasing.

The `Sub Folder` input on the Grasshopper file components (`Geometry To File`, `Data To File`,
`Block To File`, `File From Path`, `Render PDF`, `Render SVG`) gains `::` as a nesting separator,
matching Rhino's layer syntax. The **first segment is the root**, and it names the archive instead
of becoming a folder inside it:

| `Sub Folder`          | Downloads as                          |
| --------------------- | ------------------------------------- |
| _(empty)_             | `<widget>.zip` → `model.3dm`          |
| `Panels`              | `Panels.zip` → `model.3dm`            |
| `ROOT::Panels`        | `ROOT.zip` → `Panels/model.3dm`       |
| `ROOT::First::Second` | `ROOT.zip` → `First/Second/model.3dm` |

Files sharing a root travel in one archive; **distinct roots produce separate archives.** Two
components writing `ROOT::Panels` and `OTHERROOT::Panels` into the same Context Bake now download as
`ROOT.zip` and `OTHERROOT.zip`. This is the point of the change — it makes grouping authorable from
the file components, which is the only place a Hops Context Bake leaves you any control.

Roots are matched literally, so `ROOT` and `Root` are two different archives. Folder names are
case-sensitive on Linux and macOS, and silently merging them would be its own surprise.

## Migration

**A definition whose files use two or more distinct `Sub Folder` values now downloads as several
zips instead of one.** Nothing is lost — the same files with the same relative structure — but the
count of downloaded archives changes, their names change, and one folder level moves out of the
archive into its name:

```diff
  # Sub Folder = "Panels" on one component, "Frames" on another
- files.zip
-   Panels/a.3dm
-   Frames/b.3dm
+ Panels.zip
+   a.3dm
+ Frames.zip
+   b.3dm
```

To keep a single archive, give those components a shared root: `Group::Panels` and `Group::Frames`
download as one `Group.zip` containing `Panels/a.3dm` and `Frames/b.3dm`.

Definitions that leave `Sub Folder` empty are unaffected — still one flat archive named after the
output widget.

Browsers may prompt before saving more than one file per click ("Allow this site to download
multiple files?"). That is inherent to producing several archives from one gesture.

## Fixes

**`::` used to fail outright.** Baking to disk passed the raw value to `Directory.CreateDirectory`,
which throws `IOException` on Windows because `:` is illegal in a directory name; the web path
produced a literal folder named `ROOT::Panels`. Neither did what anyone typing it would expect, so
no definition can have depended on the old behaviour. `/` and `\` are now accepted as separators
too, and `.`, `..` and drive-letter segments are dropped on both paths.

**The output widget's folder tree split on `/` only.** A `::` value rendered as one folder named
after the separator — `Main::Panels` and `Main::Frames` showed as two sibling folders rather than
one `Main` with two children, disagreeing with the archive the download actually produced. The
tree and its duplicate-name check now use the same segmentation as the archive
(`subFolderSegments`, exported from `@selvajs/compute/core` so a host rendering its own tree can
agree with it).

**File `metadata` reached cloud consumers but never local ones.** The WebSocket collector built its
payload by hand and omitted the field, so the same definition returned metadata through
Rhino.Compute and dropped it through the plugin's local server.

**`additionalFiles` were dropped when every file had a root.** They attached only to the rootless
archive, which does not exist in that case. They now ride with the first archive, and extras with no
files at all still produce one.

## API

New on `@selvajs/compute/core`:

- `downloadFileDataByRoot(files, fallbackName, additionalFiles?)` — the per-root archive split.
  `fallbackName` names the archive for files with no root.
- `groupFilesByRoot(files)` — just the grouping, no DOM. For consumers that write files themselves
  rather than zipping them; `downloadFileData` is browser-only and throws in Node, this is not.
- `subFolderSegments(subFolder)` — the folder segments of one value. For rendering a tree that
  matches the archive.

`downloadFileData` is unchanged and still exported.

`@selvajs/ui`'s `downloadFiles` keeps its signature — its second argument is now the fallback name
used only when files carry no root. The grouping logic it briefly owned moved into
`@selvajs/compute`, where the `Sub Folder` convention already lived; a copy in the UI package would
have been a third place to keep in sync with the plugin and the archive sanitizer.
