---
'@selvajs/ui': patch
---

Esc aborts a running solve and says so the same way in every host: the Rhino panel, a browser tab and Rhino.Compute. Before, a browser tab ignored Esc and only the panel showed the hint, and only after a slow solve. The live panel's Abort button and the Calculate button while solving show an Esc key, and the floating solving indicator reads "Esc aborts the solve" instead of "This can take a moment…".
