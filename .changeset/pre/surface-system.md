---
'@selvajs/ui': minor
'@selvajs/selva': patch
---

One surface system for light and dark. Cards, rows, menus and fields sit on a fixed set of roles (canvas, surface, raised, well, field), hover and selection are overlays that work on any surface, and every field edge and slider track reaches 3:1 in both modes. Corners follow one concentric radius scale.

New tokens: `raised`, `field`, `hover`, `selected`, `border-strong`, `faint-foreground`, `shadow-raised`, `shadow-popover`, `rounded-inner`. Removed: `accent` and `accent-foreground` (use `hover` or `selected`), the `sidebar-*` tokens, `inputparam`, `outputparam` and the `--radius` base variable. The alternate themes are gone too: the `@selvajs/ui/styles/themes/*` export, `ThemeSwitcher` and the theme store.
