# Third-Party Notices

Selva bundles or embeds the following third-party components. Full license
texts ship alongside the components where noted.

## Inter (font)

- **What:** `Inter-Regular.ttf` and `Inter-Bold.ttf`, embedded as resources in
  `Selva.Drawing.dll` for drawing/PDF text rendering.
- **License:** SIL Open Font License 1.1, Copyright (c) 2016 The Inter Project
  Authors (https://github.com/rsms/inter)
- **License text:** [Plugin/Selva.Drawing/Fonts/Resources/LICENSE.txt](Plugin/Selva.Drawing/Fonts/Resources/LICENSE.txt)

## PDFsharp

- **What:** `PDFsharp` 6.2.4 (`PdfSharp`, `PdfSharp.System`, `PdfSharp.Shared`) is merged
  (internalized via ILRepack) into `Selva.Drawing.dll` in Release builds.
- **License:** MIT, Copyright (c) 2001-2026 empira Software GmbH
  (https://github.com/empira/PDFsharp). Releases from 6.5.0 on are AGPL-3.0 and are not used.

## Microsoft.Extensions.Logging.Abstractions / DependencyInjection.Abstractions, Microsoft.Bcl.AsyncInterfaces

- **What:** PDFsharp's dependencies, merged (internalized via ILRepack) into
  `Selva.Drawing.dll` in Release builds.
- **License:** MIT, Copyright (c) .NET Foundation and Contributors
  (https://github.com/dotnet/runtime)

All other dependencies are consumed as ordinary NuGet/npm packages under their
respective licenses; see each package manifest for details.
