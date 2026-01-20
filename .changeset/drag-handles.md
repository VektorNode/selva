---
'@selva/builder-app': patch
---

Add explicit drag handles to prevent interference with interactive elements

**Changes:**

- **Drag Handles**: Added `GripVertical` icons as dedicated drag handles for tabs, groups, and group items
- **Improved UX**: Text inputs, number inputs, and other controls are now fully interactive without accidentally triggering drag operations
- **Visual Feedback**: Drag handles show hover background (`hover:bg-accent`) to clearly indicate draggable areas
- **Cleaner Implementation**: Removed workarounds like `onmousedown`/`onmouseup` handlers that disabled dragging on inputs

**Affected Components:**

- `BuilderGroupItem`: Drag handle for input/output parameters
- `EditableGroup`: Drag handle for group reordering
- `EditableTabNav`: Drag handle for tab reordering

**Technical Details:**

- Only the drag handle element is `draggable="true"` instead of the entire container
- Handles use `self-start` positioning to match icon size rather than spanning full height
- Standard grip-vertical icon provides clear visual affordance for drag operations
