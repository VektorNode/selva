---
'@selvajs/selva': patch
---

Fix the project settings dialog overflowing the viewport when a project has many
members, and rework its layout so the added height is used deliberately.

**The dialog had no height bound.** `Dialog.Content` renders as a grid with
auto-sized rows and no `max-height`, so the members list grew with the member
count and pushed the dialog past the top and bottom of the screen — with 60+
members, the tab bar and the "Add member" button were both unreachable. The
dialog is now a flex column capped at `calc(100dvh-2rem)`, the tab area has a
fixed shared height, and only the member list scrolls. Both tabs occupy the same
box, so switching between them no longer resizes the dialog.

**Member rows overflowed horizontally.** The avatar, role `<select>`, and remove
button had no `shrink-0`, so a long display name or an unbroken email string
stretched the row instead of truncating, pushing the role control off the right
edge. Those controls now hold their width and the name column absorbs the
squeeze, so `truncate` applies as intended.

**Layout rework.** Delete/Cancel/Save moved out of the scrollable General form
into a pinned footer shared by both tabs, so the actions no longer scroll away
with the form. The description textarea grew from 2 to 5 rows, and the Visibility
options are now short labels (Public/Org/Private) with the explanation moved to
helper text below the select.

Also fixes a pre-existing bug surfaced by that rework: `ProjectVisibility`
includes a fourth `platform` variant that the select never offered, so opening a
platform-visibility project showed a select with no matching option and saving
silently coerced it to `public`. `platform` is now preserved as a conditional
option when already set. It stays absent from the list otherwise, since that
visibility is granted by platform admins rather than chosen here.
