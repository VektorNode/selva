# selva-compute-app

## 0.4.1

### Patch Changes

- Updated dependencies [b9d05f8]
- Updated dependencies
  - @selva/shared@1.4.0

## 0.4.0

### Patch Changes

- 71fe8f7: Add ComputeMessages component with floating indicator for Grasshopper solve errors and warnings
  - New `ComputeMessages` component with floating button indicator always visible in bottom-right
  - Click to open modal dialog showing full error/warning dashboard
  - Groups duplicate messages to reduce noise (e.g., "×247" for repeated warnings)
  - Collapsible sections within dialog for errors (expanded by default) and warnings (collapsed)
  - Errors displayed in red with destructive styling, warnings in yellow
  - Badge shows count breakdown (e.g., "3 Errors • 247 Warnings")
  - Integrated into compute-app solve flow to extract and display errors/warnings from Rhino Compute responses
  - Uses shadcn-svelte Dialog, Collapsible, Button, and Badge components
  - Updated to use new Lucide icon names (CircleAlert, TriangleAlert)

- Updated dependencies [71fe8f7]
- Updated dependencies [bc602c2]
- Updated dependencies [bc602c2]
  - @selva/shared@1.3.0

## 0.3.0

### Patch Changes

- Updated dependencies [cd6ad4b]
  - selva-compute@1.2.0
  - @selva/shared@1.2.0

## 0.2.0

### Patch Changes

- **Minor Updates**
  - Migrate to @selva/shared components for UI consistency
  - Update favicon and branding assets
  - Add robots.txt and web app manifest
  - Update example Grasshopper file (selva_example_0_1_0.gh)
  - Improve error handling and layout structure
- Updated dependencies
- Updated dependencies
  - selva-compute@1.1.0
  - @selva/shared@2.0.0
