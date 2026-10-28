---
'@selvajs/plugin-ui': patch
---

The preview's solving indicator shows again. It never appeared, in the Rhino panel or a browser tab, because the page checked whether a solve was running before its connection to Grasshopper was set up and never checked again. Opening the preview also asks Grasshopper for its initial data once instead of three times, so a large schema is sent once.
