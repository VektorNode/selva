// Viewer code reads browser globals at module and factory scope (`window.devicePixelRatio` in
// `applyDefaults`, `Worker`/`Blob`/`URL` feature-detection in the edge extractor). The suites here
// run under `environment: 'node'` because almost nothing needs a DOM — so provide the minimum
// surface those reads touch rather than paying for jsdom across every file.
//
// `window` is deliberately an empty object, not a populated stub: `devicePixelRatio` then reads
// `undefined`, `Math.min(undefined, 2)` is `NaN`, and the `||` in `applyDefaults` falls through to
// the caller's value — which is exactly what the default-resolution tests assert. A stub that
// supplied a real DPR would mask that path.
if (typeof window === 'undefined') {
	(globalThis as { window?: unknown }).window = {};
}
