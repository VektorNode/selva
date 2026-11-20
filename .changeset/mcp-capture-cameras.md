---
'@selvajs/mcp': minor
'@selvajs/selva': minor
'@selvajs/schemas': minor
'@selvajs/ui': patch
---

`selva_capture_preview` takes free cameras (azimuth, elevation, zoom, target), several per call as separate pictures or one contact sheet, fits the camera to the geometry, and can hide layers or cut away the walls facing the camera. `selva_solve` reads computed lists back as each input's current options and pick, and charts as labels and numbers; `selva_describe_definition` says which lists are computed in the solve. A capture whose HDR can't be read renders with the generated environment instead of failing, and the Selva build fails when `baseHDR.hdr` is missing from `build/client`. The form model (`buildFormModel` and its helpers) moves to `@selvajs/schemas`; `@selvajs/ui` still exports it.
