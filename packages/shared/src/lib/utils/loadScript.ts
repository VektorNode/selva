/**
 * Load an external script from a CDN with automatic deduplication.
 * All calls to load the same script will share a single promise,
 * preventing duplicate script tags and race conditions.
 *
 * @param src The script URL
 * @param options Script attributes (crossOrigin, async, etc.)
 * @returns Promise that resolves when script is loaded
 */

const scriptLoaders = new Map<string, Promise<void>>();

export function loadScript(
	src: string,
	options?: {
		crossOrigin?: string;
		async?: boolean;
		defer?: boolean;
	}
): Promise<void> {
	// Return existing promise if already loading/loaded
	if (scriptLoaders.has(src)) {
		return scriptLoaders.get(src)!;
	}

	// Check if script already exists in DOM
	if (document.querySelector(`script[src="${src}"]`)) {
		const resolved = Promise.resolve();
		scriptLoaders.set(src, resolved);
		return resolved;
	}

	// Create and load script
	const promise = new Promise<void>((resolve, reject) => {
		const script = document.createElement('script');
		script.src = src;
		if (options?.crossOrigin) script.crossOrigin = options.crossOrigin;
		if (options?.async !== undefined) script.async = options.async;
		if (options?.defer !== undefined) script.defer = options.defer;

		script.onload = () => resolve();
		script.onerror = () => {
			scriptLoaders.delete(src);
			reject(new Error(`Failed to load script: ${src}`));
		};

		document.head.appendChild(script);
	});

	scriptLoaders.set(src, promise);
	return promise;
}
