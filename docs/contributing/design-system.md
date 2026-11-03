# Design system

Every Svelte package (`@selvajs/ui`, the plugin UI, the Selva app, the website) draws from one
set of tokens in [packages/ui/src/lib/styles/base.css](../../packages/ui/src/lib/styles/base.css).
Light and dark use the same token names and the same roles; a mode only changes values. Pick a
token by what the thing _is_, never by the grey you want, and both modes come out right.

## Surfaces

| Role    | Class           | Use it for                                                                                             |
| ------- | --------------- | ------------------------------------------------------------------------------------------------------ |
| canvas  | `bg-background` | The app background.                                                                                    |
| surface | `bg-card`       | Cards, panels, group headers.                                                                          |
| raised  | `bg-raised`     | Things that sit on a surface: list rows, menus, popovers, dialogs, the chosen segment, the active tab. |
| well    | `bg-muted`      | Recessed areas: trays that hold rows, tab-list tracks, code, table heads, skeletons.                   |
| field   | `bg-field`      | Anything you type into or toggle. Same fill as the well in both modes; the edge marks it.              |

Nesting moves toward the viewer: canvas, then surface, then raised. Dark mode shows that by
getting lighter. Light mode can't get lighter than white, so raised is white too and lifts with
`border` and `shadow-raised` instead. Give a raised thing both, and it reads right in both modes.

Wells go the other way: darker than what's around them. A tray of draggable rows is a `bg-muted`
well holding `bg-raised` rows, never rows darker than their container.

Fields are recessed like wells, and `border-input` carries the boundary. A field on a well
shares its fill, so the edge is all that marks it there.

## States

`bg-hover` and `bg-selected` are translucent overlays of the ink colour (white in dark, black in
light). They work on any surface, so a new component never needs its own hover grey.

- Hover: `hover:bg-hover`.
- Current item, pressed toggle, open trigger: `bg-selected`.
- A filled neutral button rests on `bg-secondary` and hovers to `bg-selected`.

The accent (`primary`) means state or action only: the primary button, the active tab marker,
slider fill, a checked box, type badges. Never use it for decoration.

## Edges and text

| Class                   | Use it for                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------ |
| `border` (default)      | Card and section outlines, separators.                                               |
| `border-border-strong`  | Menus, popovers, outline buttons, dashed drop zones.                                 |
| `border-input`          | The edge of a field, checkbox, switch or slider track: 3:1 against its surroundings. |
| `text-foreground`       | Body text and values.                                                                |
| `text-muted-foreground` | Labels, descriptions: 4.5:1 on every surface.                                        |
| `text-faint-foreground` | Icons, placeholders, disabled text: 3:1.                                             |

Neutral roles never take an opacity modifier. `border-border/60` or `text-muted-foreground/50`
is a grey nobody checked for contrast and that drifts between modes; use the role that means
what you want. Colour roles (`primary`, `destructive`, `success`, …) can be tinted, and so can
`background`, `card` and `popover` for a translucent sticky header.

## Radius

Concentric: an item inside a padded container takes the container's radius minus the padding.

| Class           | Use it for                                                                |
| --------------- | ------------------------------------------------------------------------- |
| `rounded-sm`    | Chips, badges, checkboxes.                                                |
| `rounded-inner` | An item inside a control or a menu: segments, menu items, the active tab. |
| `rounded-md`    | Controls, buttons, list rows, tab-list tracks.                            |
| `rounded-lg`    | Menus, popovers, segmented-control tracks.                                |
| `rounded-xl`    | Cards, dialogs.                                                           |
| `rounded-full`  | Dots, avatars, slider thumbs.                                             |

## Spacing

A 4px grid, and the proximity rule: space inside a unit is never larger than the space around
it.

| Gap | Where                                            |
| --- | ------------------------------------------------ |
| 2   | Segmented-control track padding.                 |
| 6   | Label to its control.                            |
| 8   | Between buttons, between list rows in a tray.    |
| 12  | Between cards, panel padding.                    |
| 16  | Between fields in a card.                        |
| 24  | `Card` primitive padding and header-to-body gap. |

Insets are symmetric: a card's header and body both sit 24 from the edge. Controls are 36 tall;
compact header buttons 32.

## What the lint catches

`selva/surface-roles` ([packages/config/eslint-rules/surface-roles.js](../../packages/config/eslint-rules/surface-roles.js))
is an error in every package: an opacity modifier on a neutral role, a removed token (`accent`,
`sidebar`), and a radius off the scale (the website opts out of the radius check). On top,
`shadcn/no-unknown-classes` flags any class Tailwind doesn't know, which covers typos and a
token that doesn't exist. It is an error in `ui`, `plugin-ui` and `selva`, a warning elsewhere.

A native `<select>` is an error everywhere: its popup is drawn by the OS and ignores the theme.
Use `FilterableDropdown` (`name` for a plain form post, `size="sm"` in a filter bar).

Spacing and choosing the right role can't be linted. That's this page.

## Adding a token

Add it to both `:root` and `.dark` in `base.css`, map it under `@theme inline`, and check its
contrast in both modes against every surface it can sit on. If it's a neutral role, add it to
`NEUTRAL_ROLES` in the lint rule so it can't be dimmed either.
