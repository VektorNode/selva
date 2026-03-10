# Obsolete Components Naming Guide

This guide ensures consistent naming and organization of deprecated/obsolete components and their upgraders across the Selva plugin.

## Purpose

All deprecated components and upgraders follow a **consistent pattern based on the last version they were valid for**. This makes it immediately clear:
- When a component became obsolete
- What its purpose is (legacy component vs. upgrader)
- How to maintain backward compatibility

## Naming Conventions

### Obsolete Components

**Pattern:** `OBSOLETE_{ComponentName}_UntilVX_Y_Z.cs`

**Example:** `OBSOLETE_BlockToFile_UntilV0_6_2.cs`

**Components:**
- Prefix: `OBSOLETE_` — clearly marks as deprecated
- Component name: matches the current component name (without "GH_" prefix)
- Version suffix: `_UntilVX_Y_Z` — last version this component was valid for
- Class name: mirrors filename (e.g., `OBSOLETE_BlockToFile_UntilV0_6_2`)
- Exposure: `GH_Exposure.hidden` — hidden from users, only for backward compatibility

**Why this pattern?**
- Immediately shows when support was dropped (version number in name)
- Prevents confusion with active components
- Mirrors filename in class name for easy navigation
- Hidden from UI so users don't accidentally use obsolete versions

### Upgrader Components

**Pattern:** `GH_{ComponentName}Upgrader.cs`

**Example:** `GH_BlockToFileUpgrader.cs`

**Components:**
- Prefix: `GH_` — Grasshopper convention
- Component name: matches the current component (without "OBSOLETE_" or version suffix)
- Suffix: `Upgrader` — clearly indicates purpose
- Class name: mirrors filename (e.g., `GH_BlockToFileUpgrader`)
- Interface: `IGH_UpgradeObject` — Grasshopper upgrade mechanism

**Why this pattern?**
- Follows Grasshopper naming conventions
- Clearly distinguishes upgraders from actual components
- Prevents naming conflicts or confusion
- Makes upgraders easy to find and understand at a glance

## Directory Structure

All obsolete components and upgraders belong in a centralized `OBSOLETE/` folder within each feature:

```
Plugin/Selva.GH/Features/Display/OBSOLETE/
├── OBSOLETE_WebDisplay_UntilV0_2_0.cs      (deprecated in v0.2.0)
├── OBSOLETE_WebDisplay_UntilV0_5_0.cs      (deprecated in v0.5.0)
└── GH_WebDisplayUpgrader.cs                (migrates to current version)

Plugin/Selva.GH/Features/FileIO/Components/OBSOLETE/
├── OBSOLETE_BlockToFile_UntilV0_6_2.cs     (deprecated in v0.6.2)
├── OBSOLETE_DataToFile_UntilV0_6_2.cs      (deprecated in v0.6.2)
├── GH_BlockToFileUpgrader.cs               (migrates to current version)
└── GH_DataToFileUpgrader.cs                (migrates to current version)
```

## Implementation Checklist

When deprecating a component:

1. **Create the obsolete component:**
   - Rename/copy current component: `GH_MyComponent.cs` → `OBSOLETE_MyComponent_UntilVX_Y_Z.cs`
   - Update class name: `GH_MyComponent` → `OBSOLETE_MyComponent_UntilVX_Y_Z`
   - Set `Exposure` to `GH_Exposure.hidden`
   - Move to `/OBSOLETE/` folder
   - Keep all original functionality intact

2. **Create the upgrader:**
   - Create new file: `GH_MyComponentUpgrader.cs`
   - Implement `IGH_UpgradeObject` interface
   - Map old inputs/outputs to new component
   - Set `UpgradeFrom` GUID (old component GUID)
   - Set `UpgradeTo` GUID (new component GUID)
   - Set `Version` to current date

3. **Ensure backward compatibility:**
   - Test upgrading old definitions with the obsolete component
   - Verify upgraded definitions work with new component
   - Document any breaking changes in upgrader comments

## Current Status

### FileIO Components
- ✅ `OBSOLETE_BlockToFile_UntilV0_6_2.cs` + `GH_BlockToFileUpgrader.cs`
- ✅ `OBSOLETE_DataToFile_UntilV0_6_2.cs` + `GH_DataToFileUpgrader.cs`

### Display Components
- ✅ `OBSOLETE_WebDisplay_UntilV0_2_0.cs` + `GH_WebDisplayUpgrader.cs`
- ✅ `OBSOLETE_WebDisplay_UntilV0_5_0.cs`

## Notes

- **Do not** remove obsolete components without a major version bump
- **Do not** mix obsolete and current component naming patterns
- **Always** create an upgrader when deprecating a component with a public GUID
- **Keep** obsolete components functional to ensure backward compatibility
- **Document** breaking changes in upgrader XML comments
