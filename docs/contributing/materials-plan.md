# Materials in the web viewer

A material is three things:

1. **Surface response**: colour, metalness, roughness, clearcoat, anisotropy, transmission.
2. **Texture set**: colour / roughness / normal maps, with one real-world size (`mapSize`, mm).
3. **Mapping**: where the texture coordinates come from (`UvMapping`, C# only).

## Mapping

UVs travel in **millimetres** (`DrawingUnits.ActiveDocMmPerUnit`). With `mapSize` set the viewer
sets `RepeatWrapping`, `repeat = 1 / mapSize` across and `1 / (mapSize · aspect)` down.

| Mode       | Coordinates                                                                  | Code                            |
| ---------- | ---------------------------------------------------------------------------- | ------------------------------- |
| `Surface`  | Rhino's UVs as authored                                                      |                                 |
| `Part`     | U along the part's grain projected into each face, V across it               | `GrainUvs.cs`                   |
| `World`    | box projection by the vertex normal's dominant axis                          | `BoxUvs.cs`                     |
| `Authored` | the input mesh's own UVs in model units, scaled to mm; `Part` for Brep input | `DisplayUvs.cs`                 |
| `Auto`     | `Surface` for a texture without a size, else `Part`                          | `ThreeMaterial.ResolvedMapping` |

`DisplayUvs.Apply` is the one entry point, public so a plugin assembling its own batch (vektor-fab's
Model Display) runs the same step; with `MaterialPresets.Find` + `ToMaterial` it gets the same
materials too.

The grain is the bend axis if the part is folded or rolled, the longest in-plane extent if flat.
A Brep face elongated more than 45° off that axis (twice as long as wide) takes its own long axis:
a mitred corner piece turns its normals 90° about the vertical, so its part grain came out vertical
and both legs streaked across instead of along (measured on `sheets.3dm`). Meshes arrive welded, so
only Brep input gets the per-face grain.

Each `Part` gets an offset seeded from its item id (FNV-1a, not `string.GetHashCode`, which is
randomized per process), so neighbouring boards don't show the same patch. `World` shifts each part by
whole kilometres so float32 UVs keep 0.06 mm steps on survey coordinates; it classifies per vertex,
so a smooth surface turning through 45° smears one row of triangles. `Part` assumes one Display item
is one part; a joined assembly gets one grain for all of it.

The grain comes from each triangle's exact second moment, `A/12 · (aaᵀ + bbᵀ + ccᵀ + 9mmᵀ)`:
centroids alone put both of a two-triangle rectangle's samples on its diagonal. U projects the
grain into the face first, `grain − (grain·n) n`.

**Open: V on curved faces.** `p · (n × grain)` with a per-vertex normal is not arc length and
collapses on a roll centred on its axis: on an R 100 half-tube, V spans 136 for a 314 arc. Tangents
don't depend on V (below), so this only matters for textures on rolled parts. `Unroller(brep)` with
the mesh vertices as `AddFollowingGeometry` returned every point exactly unrolled for an open
half-tube and a closed 8-face L solid. It needs a developable Brep, and the unrolled layout still
has to be rotated so its U matches the projected U. `MeshUnwrapper` (LSCM, ABF++, ARAP) handles any
mesh but returns 0-1 and is conformal: rescale by √(3D area / UV area).

## Tangents

`grain-tangents.ts` builds the `tangent` attribute after the crease split, from U's gradient alone,
in the mesh-assembly worker. three's `computeTangents()` leaves a zero tangent wherever V is
constant across a triangle, which renders NaN-black. No wire channel: that would cost an SLVA flag
bit, a version gate and fixtures for the same result.

## Presets

The presets live in `MaterialPresets.cs` and come out of the **Material Preset** component as a
finished material. Three Material takes one as `Base`, and any wired input beats the base, Finish,
Transmission and IOR included. So Color, Metalness, Roughness, Opacity and Transparent have no
persistent defaults: a default would count as wired and beat the base. The preset index is saved in
definitions, so the list is append only.

Glass uses `transmission` 1 and `ior` 1.52, not opacity, so it keeps its reflections. Transmission
costs an extra render pass of the opaque scene.

**Procedural finish.** `brushed` and `rolled` (`batch/finish.ts`) work from the UVs in mm and scale
roughness, brightness (by half) and the normal. Fibres are hard-edged across the grain, 2-40 mm long,
each its own depth (most faint, a few deep) and tapered at both ends; one depth per row read as a
single streak the height of the part. The normal tilts across the grain by the fibre depth, so single
fibres glint. Only `rolled` gets bands (long soft streaks): on brushed, bands 1.5-6 mm wide and
150-500 mm long read as full-height streaks on a profile wall. Past pixel size a fibre layer switches
to coarser cells standing for the rows they cover, so distance keeps the texture without shimmer.
Fading octaves out instead left only the widest, softest one at wall distance: soft full-height
bands, nothing like the photos. Tuned by eye against photos of brushed stainless at 120 mm, 350 mm
and 0.9 m; `finishStrength` scales the whole finish (0 off).

Wood, concrete, plaster, brick and corten are procedural patterns in `batch/surface-finish.ts`, also
in mm, so a brick is brick-sized at any model scale. Galvanised spangle and the weathered-zinc patina
need real scans: CC0 sets (ambientCG, Poly Haven) shipped as plugin assets.

## Environment and looks

- **Metals reflect a studio room, not the HDR** (`reflection-environment.ts`). The HDR is an
  outdoor sky with a hard horizon over a near-black ground: a metal face mirrored a blown-out white
  band over a black one, the split jagged wherever the finish varied roughness. Metallic solve
  materials (metalness > 0.5) get a PMREM of a custom studio scene (`studio-environment.ts`:
  softboxes on a dark room) as their own `envMap`. three's `RoomEnvironment` is bright on all sides,
  so a metal has no contour and looks like flat paint. Everything else keeps the HDR, so the tuned
  looks don't move for dielectrics. Re-applied in `updateScene` and after `setLook`, since an
  override zeroes metalness.
- **three ignores `envMapIntensity` without a material `envMap`**: it overwrites the uniform with
  `scene.environmentIntensity` on every draw. So a look's `envMapIntensity` and Three Material's
  Reflection only act on metals, through the studio probe. There a look's value blends toward 1 by
  metalness (`lookEnvMapIntensity`).
- `disposeMaterial` skips `envMap`: the probe is shared, and every solve disposes its materials.
- `clearcoat` on the wire is the only coat; the viewer adds none to metals.
- Repro strips: `packages/visualization/examples/fixtures/repro_*.slvm`, written from Rhino through the
  real `GrainUvs` and SLVM writer. View them in the example viewer, technical and studio looks.
- Open: one HDR per look for dielectrics, overcast outdoor for site context.
- Neutral tone mapping keeps RAL colours true. ACES (studio, showcase, night) shifts saturated
  colours, so a RAL swatch will not match the chart there.

## Authored UVs from a sheet-metal unroll

`Authored` is for a host that knows the true grain, such as a sheet-metal plugin that unrolls the
part. It writes each vertex's flat-pattern position as its UV, U along the coil's rolling
direction, and hands Web Display a **mesh**: a Brep is re-meshed and its UVs become Rhino's 0-1
surface parameters, so Brep input falls back to `Part`. Bends then texture continuously along the
neutral axis, and a part nested 90° off the rolling direction shows its brushing the wrong way.

A plugin calling `DisplayUvs.Apply` itself passes `authoredUvs: true` to vouch for its mesh's UVs;
a `Part` material then uses them too, so it can take presets unchanged (vektor-fab's Model Display
with SheepMetal's `GrainMeshes.Joined`). Web Display vouches only when the material is `Authored`,
since an input mesh converted from a Brep carries surface parameters.
