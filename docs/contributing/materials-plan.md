# Materials in the web viewer: plan

Status 2026-10-01: steps 1-5 built, not yet checked by eye in a live viewer. Open: `Unroller` for
curved parts, one HDR per look, texture sets as assets, and tuning preset roughness against photos.

A material is three things:

1. **Surface response**: colour, metalness, roughness, clearcoat, anisotropy, transmission.
2. **Texture set**: colour / roughness / normal maps, with one real-world size (`mapSize`, mm).
3. **Mapping**: where the texture coordinates come from (`UvMapping`, C# only).

## What was wrong

- **UVs were Rhino's surface parameters.** 0-1 per Brep face, U pointing wherever the surface was
  built. Anisotropy grain flipped between two identical strips side by side, and any texture
  stretched once across each face.
- **Looks dimmed metal reflection.** Every look scales image-based lighting (technical:
  `envMapIntensity` 0.55 × `environmentIntensity` 0.6), and a metal is almost all reflection. An
  automatic satin clearcoat compensated, and made bare metal read lacquered.
- **No micro-variation.** Uniform roughness reads as CG.
- **Coil-coated sheet is paint, not metal**, and nothing steered a user to metalness 0.
- **Tangents came from screen-space UV derivatives**, noisy on long thin triangles.

## Mapping

UVs travel in **millimetres** (`DrawingUnits.ActiveDocMmPerUnit`). With `mapSize` set the viewer
sets `RepeatWrapping`, `repeat = 1 / mapSize` across and `1 / (mapSize · aspect)` down.

| Mode      | Coordinates                                                    | Code                            |
| --------- | -------------------------------------------------------------- | ------------------------------- |
| `Surface` | Rhino's UVs as authored                                        |                                 |
| `Part`    | U along the part's grain projected into each face, V across it | `GrainUvs.cs`                   |
| `World`   | box projection by the vertex normal's dominant axis            | `BoxUvs.cs`                     |
| `Auto`    | `Surface` for a texture without a size, else `Part`            | `ThreeMaterial.ResolvedMapping` |

The grain is the bend axis if the part is folded or rolled, the longest in-plane extent if flat.
Each `Part` gets an offset seeded from its item id (FNV-1a, not `string.GetHashCode`, which is
randomized per process), so neighbouring boards don't show the same patch. `World` shifts each part by
whole kilometres so float32 UVs keep 0.06 mm steps on survey coordinates; it classifies per vertex,
so a smooth surface turning through 45° smears one row of triangles. `Part` assumes one Display item
is one part; a joined assembly gets one grain for all of it.

**`GrainUvs` measured** in a live Rhino (doc in mm, `QualityRenderMesh`; ratio = UV edge length /
3D edge length, 1.000 is undistorted):

| Part                       | Before                                          | Now                           |
| -------------------------- | ----------------------------------------------- | ----------------------------- |
| Plate 1000×200×2           | grain 11° off the long edge; end caps 0.19–1.00 | 1.000, grain along the edge   |
| Plate, one end cut at 45°  | 0.19–1.00                                       | 1.000                         |
| L angle 100×100, 1000 long | 1.000                                           | 1.000                         |
| Rolled half-tube, R 100    | V spans 136 for a 314 arc; 0.09–1.00            | unchanged; `Unroller` is open |

The grain now comes from each triangle's exact second moment, `A/12 · (aaᵀ + bbᵀ + ccᵀ + 9mmᵀ)`:
centroids alone put both of a two-triangle rectangle's samples on its diagonal. U projects the
grain into the face first, `grain − (grain·n) n`.

**Open: V on curved faces.** `p · (n × grain)` with a per-vertex normal is not arc length and
collapses on a roll centred on its axis. Tangents no longer depend on V (below), so this only
matters for textures on rolled parts. `Unroller(brep)` with the mesh vertices as
`AddFollowingGeometry` returned every point exactly unrolled for an open half-tube and a closed
8-face L solid. It needs a developable Brep, and the unrolled layout still has to be rotated so its
U matches the projected U. `MeshUnwrapper` (LSCM, ABF++, ARAP) handles any mesh but returns 0-1 and
is conformal: rescale by √(3D area / UV area).

## Tangents

`grain-tangents.ts` builds the `tangent` attribute after the crease split, from U's gradient alone,
in the mesh-assembly worker. three's `computeTangents()` leaves a zero tangent wherever V is
constant across a triangle, which renders NaN-black. No wire channel: that would cost an SLVA flag
bit, a version gate and fixtures for the same result.

## Presets

`MaterialPresets.cs`, on Three Material's `Preset` input; every wired input overrides. Color,
Metalness, Roughness, Opacity and Transparent have no persistent defaults, or the default would count
as wired and beat the preset. Metal and concrete base colours are physicallybased.info's measured
linear values. Roughness, anisotropy and the weathered-zinc patina are starting points: tune them
against photos of the real product, never against another render.

| Preset                   | Metalness | Anisotropy | Mapping | Finish  |
| ------------------------ | --------- | ---------- | ------- | ------- |
| Stainless steel, brushed | 1         | 0.8        | Part    | brushed |
| Aluminium, mill finish   | 1         | 0.3        | Part    | rolled  |
| Galvanised steel         | 1         | 0          | World   |         |
| Titanium zinc, weathered | 0.6       | 0.2        | Part    | rolled  |
| Copper                   | 1         | 0.3        | Part    | rolled  |
| Coil-coated (RAL)        | 0         | 0          | Surface |         |
| Wood                     | 0         | 0          | Part    |         |
| Concrete                 | 0         | 0          | World   |         |
| Glass                    | 0         | 0          | Surface |         |

Glass uses `transmission` 1 and `ior` 1.52, not opacity, so it keeps its reflections. Transmission
costs an extra render pass of the opaque scene.

**Procedural finish** (`applyFinish` in `batch/materials.ts`): two octaves of 1D noise across the
grain scale roughness, from V in mm. Each octave fades out once a pixel spans a streak, or it
shimmers. Shader patches chain through `addShaderPatch`, which extends `customProgramCacheKey`:
three keys programs on it, and it defaults to the `onBeforeCompile` source, which a chain doesn't
change. Galvanised spangle, wood, concrete and patina need real scans: CC0 sets (ambientCG,
Poly Haven) shipped as plugin assets.

## Environment and looks

- A look's `envMapIntensity` blends toward 1 by metalness (`lookEnvMapIntensity`): three scales a
  material's diffuse and specular IBL together, so this keeps a dielectric's fill on the look and a
  metal's reflection the same in every look. `scene.environmentIntensity` still applies to both.
- The automatic metal clearcoat is gone; `clearcoat` on the wire is the only coat.
- Open: one HDR per look, a softbox studio for studio/showcase and overcast outdoor for site context.
- Neutral tone mapping keeps RAL colours true. ACES (studio, showcase) shifts saturated colours, so a
  RAL swatch will not match the chart there.
