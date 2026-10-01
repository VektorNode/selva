# Materials in the web viewer: plan

Status 2026-10-01: proposal, checked against the code and RhinoCommon 8.35 in a live Rhino. Interim
fix in place: `GrainUvs` (see Mapping), with the flat-face defects below fixed.

A material is three things, and today only the first is modelled:

1. **Surface response**: colour, metalness, roughness, clearcoat, anisotropy (`ThreeMaterial`).
2. **Texture set**: colour / roughness / normal maps, each with a real-world size.
3. **Mapping**: where the texture coordinates come from.

## What is wrong today

- **UVs are Rhino's surface parameters.** 0-1 per Brep face, U pointing wherever the surface was
  built. Anisotropy grain flips between two identical strips side by side, and any texture is
  stretched once across each face: textures keep three's default `ClampToEdgeWrapping` and carry no
  size.
- **A metal is its reflection, and there is one environment.** Every look uses the same 1024×512
  HDR (`baseHDR.hdr`). Looks also scale image-based lighting down (technical: `envMapIntensity` 0.55
  × `environmentIntensity` 0.6), removing most of what a metal shows. The automatic satin clearcoat
  on metals (`batch/materials.ts`) exists to compensate, and makes bare metal read lacquered.
- **No micro-variation.** Uniform roughness reads as CG. Real sheet has rolling marks, spangle,
  patina.
- **Coil-coated sheet is paint, not metal.** A RAL-coated panel is a dielectric film (metalness 0).
  Nothing steers a user to that; parameters are picked by eye per definition.
- **Tangents come from screen-space UV derivatives.** Noisy on long thin triangles, and zero where U
  is constant across a face (`GrainUvs` swaps the axis on end caps to avoid that).

## Mapping

UVs travel in **millimetres**: the writer scales by
`RhinoMath.UnitScale(doc.ModelUnitSystem, UnitSystem.Millimeters)`. Today nothing under
`Features/Display` converts, so `GrainUvs` emits model units. The material carries each map's real
size; the viewer sets `RepeatWrapping` and `repeat = 1 / size`. Geometry stays texture-agnostic.

| Mode      | Coordinates                                                                                  | For                                     |
| --------- | -------------------------------------------------------------------------------------------- | --------------------------------------- |
| `surface` | Rhino's UVs as authored                                                                      | meshes with a deliberate Rhino mapping  |
| `part`    | U along the part's grain projected into each face, V across it; unrolled on curved faces     | metal grain, wood, anything directional |
| `world`   | none on the wire: triplanar in the shader, from position relative to the model origin, in mm | concrete, plaster, stone: no direction  |

The grain is the bend axis if the part is folded or rolled, the longest in-plane extent if flat.

**`GrainUvs` measured** (doc in mm, `QualityRenderMesh`; ratio = UV edge length / 3D edge length,
1.000 is undistorted):

| Part                       | `GrainUvs` today                                | Fixed                       |
| -------------------------- | ----------------------------------------------- | --------------------------- |
| Plate 1000×200×2           | grain 11° off the long edge; end caps 0.19–1.00 | 1.000, grain along the edge |
| Plate, one end cut at 45°  | 0.19–1.00                                       | 1.000                       |
| L angle 100×100, 1000 long | 1.000                                           | 1.000                       |
| Rolled half-tube, R 100    | V spans 136 for a 314 arc; 0.09–1.00            | `Unroller`: 500 × 314.2     |

- **Wrong grain on coarse flat parts.** The in-plane spread sums triangle centroids only. A
  rectangle meshed as two triangles has both centroids on a diagonal, so the grain tilts towards it.
  Use each triangle's exact second moment, `A/12 · (aaᵀ + bbᵀ + ccᵀ + 9mmᵀ)`.
- **Stretch on faces oblique to the grain.** U is `p · grain` with the grain not projected into the
  face, so U shrinks by the sine of its angle to the normal, down to 0.1 before the end-cap fallback.
  Project first: `grain − (grain·n) n`.
- **V on curved faces is not arc length.** `p · (n × grain)` with a per-vertex normal collapses on a
  roll centred on its axis. `Unroller(brep)` with the mesh vertices as `AddFollowingGeometry` returned
  every point, exactly unrolled, for an open half-tube and for a closed 8-face L solid (one flat
  piece). It needs a developable Brep; meshes and doubly curved parts fall back to projection.
  `MeshUnwrapper` (LSCM, ABF++, ARAP) handles any mesh, but returns 0-1 and is conformal, not
  isometric: rescale by √(3D area / UV area).

With both fixes `part` is an isometry on every flat face, so a texture is never stretched; it seams
at creases, where the viewer splits vertices anyway. Each part gets an offset seeded from a stable
identity (geometry hash or object id, never the batch index, or textures jump on every re-solve), so
neighbouring boards don't repeat the same patch.

Mapping is a material property: a preset always wants the same one. `part` assumes one Display item
is one part. That holds for vektor-fab, where each part is its own Brep; a joined assembly gets one
grain for all of it. `GrainUvs` runs today only for anisotropic materials without maps; mapping as a
material property replaces that gate.

## Tangents

three uses a `tangent` attribute in place of derivatives when the geometry has one and the material
has a normal map or anisotropy. Compute it client-side with `geometry.computeTangents()` (or
`computeMikkTSpaceTangents`) after the crease split in `crease-normals.ts`. Clean `part` UVs give
clean tangents; the noise today comes from per-pixel derivatives, not the UVs. A wire channel would
cost an SLVA flag bit, a version gate and new fixtures (see [slva-format.md](./slva-format.md)) for
the same result. `world` needs no attribute: triplanar normal maps take a tangent frame per
projection axis in the shader.

## Presets

A `Preset` on Three Material sets defaults; every wired input still overrides. Base colours come from
a measured reference (physicallybased.info), roughness is tuned against photos of the real product,
never against another render.

`Preset`, mapping and map sizes are new inputs on a released component. Add them in one revision:
one OBSOLETE snapshot and upgrader (the third, after `UntilV0_15_0` and `UntilV0_20_3`), per
[STRUCTURE.md](../../STRUCTURE.md#changing-a-components-parameters-obsolete--upgrader).

| Preset                   | Metal | Anisotropy | Mapping | Maps                         |
| ------------------------ | ----- | ---------- | ------- | ---------------------------- |
| Stainless, brushed       | yes   | high       | part    | procedural brushed roughness |
| Aluminium, mill finish   | yes   | low        | part    | procedural rolled roughness  |
| Galvanised steel         | yes   | 0          | world   | spangle roughness            |
| Titanium zinc, weathered | yes   | low        | part    | patina colour + roughness    |
| Copper                   | yes   | low        | part    | procedural                   |
| Coil-coated (RAL)        | no    | 0          | none    | none; colour from RAL        |
| Wood                     | no    | 0          | part    | colour + roughness           |
| Concrete / plaster       | no    | 0          | world   | colour + roughness + normal  |
| Glass                    | no    | 0          | none    | `transmission`, not opacity  |

`transmission` costs an extra render pass of the opaque scene.

**Procedural metal finish:** brushed and rolled roughness is generated in the shader from the `part`
UVs (1D noise along U, in mm via `onBeforeCompile`). No texture assets, no tiling, always aligned
with the grain. Set `customProgramCacheKey`, or three reuses one compiled program across materials
with different patches. Brush lines a fraction of a mm apart are sub-pixel at viewing distance and
shimmer: fade the noise to its mean roughness as `fwidth(uv)` grows. Wood, concrete and patina need
real scans: CC0 sets (ambientCG, Poly Haven) shipped as plugin assets.

## Environment and looks

- One HDR per look: a softbox studio for studio/showcase, overcast outdoor for site context.
- A metal's reflection strength is its own. In three, `envMapIntensity` and
  `scene.environmentIntensity` both scale diffuse and specular IBL together, so neither can dim fill
  alone. Hold IBL constant across looks and set fill with the hemisphere and ambient lights: they add
  diffuse only, which a pure metal does not have.
- Remove the automatic metal clearcoat once the environment carries the reflections. Every saved
  metal renders differently afterwards: say so in the changeset.
- Neutral tone mapping keeps RAL colours true. ACES (studio, showcase) shifts saturated colours, so a
  RAL swatch will not match the chart there.

## Order

1. Mapping in mm (`surface` / `part` /
   `world`), texture size, `RepeatWrapping`. `Unroller` for curved parts.
2. Client-side tangents after the crease split.
3. Environment per look; constant IBL, fill from hemisphere/ambient; drop the metal clearcoat default.
4. Presets with reference base colours, in one Three Material revision.
5. Procedural brushed / rolled roughness.
6. Wood and concrete texture sets as assets.
