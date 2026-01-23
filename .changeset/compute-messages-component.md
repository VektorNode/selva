---
'@selva/shared': minor
'selva-compute-app': patch
---

Add ComputeMessages component with floating indicator for Grasshopper solve errors and warnings

- New `ComputeMessages` component with floating button indicator always visible in bottom-right
- Click to open modal dialog showing full error/warning dashboard
- Groups duplicate messages to reduce noise (e.g., "×247" for repeated warnings)
- Collapsible sections within dialog for errors (expanded by default) and warnings (collapsed)
- Errors displayed in red with destructive styling, warnings in yellow
- Badge shows count breakdown (e.g., "3 Errors • 247 Warnings")
- Integrated into compute-app solve flow to extract and display errors/warnings from Rhino Compute responses
- Uses shadcn-svelte Dialog, Collapsible, Button, and Badge components
- Updated to use new Lucide icon names (CircleAlert, TriangleAlert)
