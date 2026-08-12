---
'@selvajs/compute': major
---

Prune the public API and unwrap the package's internal layout. Every removed symbol has a
same-package replacement — the changes below are import rewrites, not behaviour changes.

**`./grasshopper` no longer re-exports four `./core` symbols.** `ComputeConfig`, `RetryPolicy`,
`RhinoComputeError`, and `RhinoModelUnit` reached the subpath only because the old
`src/grasshopper.ts` barrel ended with a re-export from `./core`. Import them from the package root
or from `@selvajs/compute/core` instead:

```diff
- import { RhinoComputeError, type ComputeConfig } from '@selvajs/compute/grasshopper';
+ import { RhinoComputeError, type ComputeConfig } from '@selvajs/compute';
```

**`getValues` and `getValue` are no longer exported as free functions.** Use the
`GrasshopperResponseProcessor` methods, which are exact wrappers — identical arguments minus the
leading `response`:

```diff
- import { getValues, getValue } from '@selvajs/compute/grasshopper';
- const { values } = getValues(response);
- const schema = getValue(response, { byName: 'Schema' });
+ import { GrasshopperResponseProcessor } from '@selvajs/compute';
+ const processor = new GrasshopperResponseProcessor(response);
+ const { values } = processor.getValues();
+ const schema = processor.getValue({ byName: 'Schema' });
```

**`processInputs` (plural) is removed.** It was a one-line `.map()` over `processInput`, which stays
public. Note the shape change — it took and returned an array:

```diff
- import { processInputs } from '@selvajs/compute/grasshopper';
- const inputs = processInputs(rawInputs);
+ import { processInput } from '@selvajs/compute';
+ const inputs = rawInputs.map(processInput);
```

`processInputsWithErrors`, which reported validation failures instead of logging them, is now
internal. It was never exported from a published entrypoint before this release.

**The README no longer documents a Three.js visualization layer.** That layer moved to
`@selvajs/visualization` in an earlier release, but the install line
(`npm install @selvajs/compute three`), the `three >= 0.179.0` requirement, and a troubleshooting
entry for a module that no longer exists all survived in the docs. `three` was never a dependency of
this package and installing it for `@selvajs/compute` alone was always unnecessary.

**Internal layout (no API impact).** `src/features/grasshopper/` collapsed to `src/grasshopper/`,
the duplicate outer barrel is gone, and four oversized modules were split along existing seams —
`compute-fetch.ts` (858 lines) into request/response/retry/signal/server-timing, `types.ts` into
`types/{inputs,schema,outputs}`, `input-type-parsers.ts` into transformers + numeric-rounding, and
the scheduler's public declarations into `scheduler/types.ts`. Deep imports into `src/` were never
supported; the three published entrypoints (`.`, `./grasshopper`, `./core`) are unchanged.

The `/grasshopper` subpath goes from 55 exported symbols to 50, verified by diffing the emitted
`dist/grasshopper.d.ts` before and after.
