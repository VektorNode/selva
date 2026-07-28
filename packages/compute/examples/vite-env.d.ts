/// <reference types="vite/client" />

// Lets demos import sample payloads as resolved URLs: `import url from './x.json?url'`.
declare module '*.json?url' {
	const url: string;
	export default url;
}

// Bundled binary sample fixtures (Selva Display Mesh Files) imported as resolved URLs.
declare module '*.dmf?url' {
	const url: string;
	export default url;
}
