# Local Files & Definitions Configuration

This document explains how to manage local-only files that should never be synced during updates.

## Problem

Files like `definitions-config.json` often have deployment-specific configurations that conflict with the remote repository. When performing updates, these local changes can cause merge conflicts that block the entire update process.

## Solution

Certain files are protected from git sync through a multi-layered approach:

### 1. **`.gitignore` Protection** (Ongoing)

Files are added to `.gitignore` to prevent new changes from being tracked:

```
packages/compute-app/example-definitions/definitions-config.json
packages/compute-app/definitions/**/*.json
```

### 2. **Git Index Removal** (One-time setup)

If files were already committed before being added to `.gitignore`, they must be removed from git's index:

```bash
bash scripts/local-files-setup.sh
```

This:

- Removes files from git tracking (while keeping local copies)
- Commits the change to the repository
- Ensures they're never synced in future updates

### 3. **Update Script Protection** (Automatic)

The `update.sh` script automatically:

- Detects tracked local-only files
- Removes them from git index before pulling
- Warns you about preserved local configurations

## Manual Cleanup (if needed)

If you need to manually remove a file from git tracking:

```bash
# Remove file from git history (keeps local copy)
git rm --cached packages/compute-app/example-definitions/definitions-config.json

# Or use the recovery script
bash scripts/git-recovery.sh
```

## Local Definition Files

Your local definition files in `packages/compute-app/definitions/` and `packages/compute-app/example-definitions/` are preserved locally and will never be deleted or overwritten by updates.

To back them up:

```bash
cp -r packages/compute-app/definitions ~/backup/selva-definitions-$(date +%Y-%m-%d)
```

## Troubleshooting

### Q: I see "definitions-config.json: needs merge" during update

**A:** Run the recovery script:

```bash
bash scripts/git-recovery.sh
bash scripts/update.sh
```

### Q: My local definitions disappeared

**A:** They should be preserved. Check:

```bash
ls -la packages/compute-app/definitions/
ls -la packages/compute-app/example-definitions/
```

If missing, restore from backup or copy example definitions:

```bash
cp packages/compute-app/example-definitions ~/your-definitions/definitions-config.json
```

### Q: Update still failing on this file?

**A:** Use the aggressive recovery:

```bash
bash scripts/git-recovery.sh --aggressive
bash scripts/update.sh
```

## First-Time Setup

If you're setting up a new deployment, run this once:

```bash
bash scripts/local-files-setup.sh
```

This ensures your local files are never synced, preventing future conflicts.
