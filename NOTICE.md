# Third-Party Notices

Selva bundles or embeds the following third-party components. Full license
texts ship alongside the components where noted.

## Inter (font)

- **What:** `Inter-Regular.ttf` and `Inter-Bold.ttf`, embedded as resources in
  `Selva.Drawing.dll` for drawing/PDF text rendering.
- **License:** SIL Open Font License 1.1, Copyright (c) 2016 The Inter Project
  Authors (https://github.com/rsms/inter)
- **License text:** [Plugin/Selva.Drawing/Fonts/Resources/LICENSE.txt](Plugin/Selva.Drawing/Fonts/Resources/LICENSE.txt)

## SharpZipLib

- **What:** `ICSharpCode.SharpZipLib` is merged (internalized via ILRepack) into
  `Selva.Drawing.dll` in Release builds to avoid an assembly-version collision
  with the copy Rhino ships.
- **License:** MIT, Copyright © 2000-2022 SharpZipLib Contributors
  (https://github.com/icsharpcode/SharpZipLib)

## PdfSharpCore

- **What:** `PdfSharpCore` is merged (internalized via ILRepack) into
  `Selva.Drawing.dll` in Release builds.
- **License:** MIT, empira Software GmbH and contributors
  (https://github.com/ststeiger/PdfSharpCore)

## SixLabors.ImageSharp / SixLabors.Fonts

- **What:** Both arrive via PdfSharpCore and are merged (internalized via
  ILRepack) into `Selva.Drawing.dll` in Release builds.
- **License:** Apache-2.0, Six Labors and contributors
  (https://github.com/SixLabors/ImageSharp, https://github.com/SixLabors/Fonts)

All other dependencies are consumed as ordinary NuGet/npm packages under their
respective licenses; see each package manifest for details.
