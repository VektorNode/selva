---
'@selvajs/ui': minor
'@selvajs/selva': patch
---

The design system now styles only through theme tokens, and its lint rules are errors in `@selvajs/ui`: a raw palette color, an arbitrary value, an inline style or a restyled primitive fails the build.

- New tokens in `styles/base.css`: `text-2xs`, `max-w-screen-inset`, `max-h-dialog`, `no-scrollbar`, `no-spinner`, `rounded-inherit`, `shadow-sheet` for bottom sheets, `bg-overlay` for modal scrims, and `destructive-foreground`.
- New shadcn components: `Popover`, `Command`, `DropdownMenu`, `ToggleGroup`, `Empty`, `Spinner` and `InputGroup`, which matches `Input`'s height and surface. The slider's value box is now an input group instead of hand-written CSS. `FilterableDropdown` is now a shadcn combobox, `ViewToggle` a toggle group, `StateDisplay` an empty state, and the viewer's tools menu uses checkbox and radio items.
- `SeverityIcon`, `IssueList` and the `severity` map give errors, warnings and notes one icon and one color everywhere: `Callout`, the solve messages, the message centre and preset validation.
- New variants instead of class overrides: `Card` `flush`, `Dialog.Content` `flush`, `Dialog.Title` `size="sm"`, `Tabs` `line`, `Button` `size="xs"`, `AlertDialog.Action` `variant`, and `Resizable.Handle` `line={false}`.
- Removed `Alert` (use `Callout`) and `Card.Action`. `FilterableDropdown` items take `iconClass` only; `iconStyle` is gone.
- Fixed: the solving indicator's slide-in and the viewer's fade-in now animate, the scene manager's scrollbar color applies, and `StateDisplay` text is readable in light mode.
