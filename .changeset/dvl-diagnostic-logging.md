---
'@selvajs/ui': patch
'@selvajs/selva': patch
---

Diagnostic logging for the dynamic value list memory investigation: large options-payload parses log size, option count and duration (should fire once per distinct solve result — a storm means memoization is defeated); every system auto-pick on a value list logs itself so a reconciliation loop is visible as a numbered sequence; and the browser solve line includes a JS heap watermark (Chrome) so a retention leak shows as a monotonic climb across a session.
