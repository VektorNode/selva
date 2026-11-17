// rhino3dm ships types for its main entry only.
declare module 'rhino3dm/rhino3dm.module.js' {
	import rhino3dm from 'rhino3dm';
	export default rhino3dm;
}

declare module 'rhino3dm/rhino3dm.wasm?url' {
	const url: string;
	export default url;
}
