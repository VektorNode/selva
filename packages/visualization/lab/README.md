# Viewer lab

Runs the viewer from source on recorded solves, so visual and performance work needs no Rhino. Not published. Run these from `packages/visualization`.

```bash
pnpm lab                                   # the page, hot reloading: ?scene=lamp&look=night&turn=0.6
pnpm lab:run --scene lamp,tower --look night,studio --label before
pnpm lab:run --scene lamp --look night --bench --gpu intel
pnpm lab:run --scene lamp --look night --bench --phone
pnpm lab:run --scene lamp --look night --breakdown      # what each feature costs
pnpm lab:night --label before                           # the night suite, see below
pnpm lab:diff before after                              # how far two labels' images and numbers differ
```

`lab:run` writes PNGs, `stats.json` and `bench.json` to `lab/out/<label>/`. To compare a change, run it with `--label before`, make the change, and run it with `--label after`.

- `--bench` prints orbit frame times (median and p95, waiting on the GPU), the cost of a full refine, draw calls, and the memory in geometry and shadow maps.
- `--breakdown` repeats the bench with each feature removed. `savedMs` is what that feature costs.
- `--without ao,bloom` removes features from a single run. Also `shadows`, `emissive`, `finishes` and `sun`.
- `--gpu` is `auto`, `intel` (the low-power GPU) or `software`. Software numbers say nothing about real hardware.
- `--phone` emulates a phone's screen and touch, which turns on the `lowPower` tier. It runs on this machine's GPU, so it measures the tier, not a phone.
- `--set metalReflection:0.2,bloom.strength:0.5` overrides the look's dials for one run, so a setting can be tried without editing source.
- `--frames` sets `idleRefineFrames`: 0 gives the image without refinement.
- `--background` sets the page colour behind the model, as a host would.
- `--suite night` replaces `--scene`, `--look` and the camera with a fixed list (see below).
- `--turn` (radians) and `--distance` (a multiple of the fitted distance) move the camera. `--target x,y,z` (metres) aims it elsewhere first.

Scenes are `lamp`, `tower` and `courtyard`, in [dev/viewer-scenes](../../../dev/viewer-scenes), with three metal repro strips (`repro-aluminium`, `repro-sheets`, `repro-stainless`), plus the synthetic `glass` ([glass-scene.js](glass-scene.js)): a double-skin façade and a thick tinted cube. `glass-panes` drops the cube, the only object that needs transmission. `--turn 1.2 --distance 0.7` looks through the façade. `metals` ([metal-scene.js](metal-scene.js)) puts each metal preset on a standing panel, a lying sheet, a tube and a ball. `plastics` ([plastic-scene.js](plastic-scene.js)) puts each plastic preset on a housing, a knob and a ball, `wood` ([wood-scene.js](wood-scene.js)) the wood presets on a tabletop, a board, an end-grain block, a turned leg and a bent panel, and `stone` ([stone-scene.js](stone-scene.js)) the stone and paving presets on a floor, a wall and a step. `a+b` loads two recordings together. The massing scenes fit a whole city block, so use `--distance 0.5` for the building. They're recorded output, so they go stale when a definition changes. To record a new one, enable the bridge in Rhino, copy the session URL, and run:

```bash
pnpm lab:record '<session url>' my-scene
```

## Measuring a look

`stats.json` holds numbers per object for every image, from an ID pass that tags each pixel with the object under it: mean, p10 and p90 display luma (0 to 1), the share of pixels blown out (`clippedPercent`, a channel at 250 or more) or crushed to black (`crushedPercent`, luma under 0.03), and the mean colour. A recording merged by material reports one row per material. `lab:diff` lists every object that moved past the noise floor: two runs of unchanged code agree to 0.005 in mean and 1% in the shares.

## Night suite

`pnpm lab:night` shoots `night-metals`, `night-plastics`, `night-wood`, `night-stone` and `night-glass`, each wide and close, plus two recorded lamps: `lamp-chrome` (a lamp with real lumens, wide and close) and `lamp`. The `night-*` scenes ([night-scene.js](night-scene.js)) share one rig: a pendant lamp with a warm bulb over a floor and a wall, and the category's presets as a ball and a lying tile on an arc around the lamp's axis, so each sample is the same distance from the bulb. White, 18% grey and black reference balls sit at the end of every arc: when only the grey card moves, the change was exposure, not a material. `window.lab.materials()` lists what each mesh was parsed into, emission and light included, when a scene looks wrong.

To tune, shoot a baseline, then try values without touching source:

```bash
pnpm lab:night --label base
pnpm lab:night --label try --set metalReflection:0.25
pnpm lab:diff base try
```
