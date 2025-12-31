---
"@selva/shared": minor
---

**New Package Release**
- Initialize @selva/shared package as centralized UI component library
- Migrate StateManager and themeStore from builder-app for cross-app reusability

**UI Components**
- Add comprehensive shadcn-svelte component set (alert-dialog, badge, button, card, checkbox, dialog, input, label, select, separator, slider, switch, tabs, textarea)
- Add FileInput component with drag-and-drop support and file validation
- Add PageFooter, PageHeader, and PageContainer layout components
- Add ThemeSwitcher component with dark/light mode support

**Theme System**
- Implement theme management system with multiple presets (Selva, Ocean, Cyberpunk, Neutral)
- Add theme store with reactive state management
- Include custom CSS theme files with CSS variables

**Preview Features**
- Add FileDownloadWidget, InputControl, OutputDisplay, and TabLayout components
- Implement preview handlers, notifications, and 3D viewer utilities
- Add throttle utility for improved slider responsiveness

**Utilities**
- Add application constants for file upload size limits
- Add file download, param export, and debounce utilities
- Export shared utility functions
