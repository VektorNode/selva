const scriptLoaders = new Map<string, Promise<void>>();

/**
 * Appends a `<script>` for `src` and resolves on load. Concurrent calls for the same URL share
 * one promise, so a script never gets a second tag. A failed load is evicted so a retry can run.
 */
export function loadScript(
	src: string,
	options?: {
		crossOrigin?: string;
		async?: boolean;
		defer?: boolean;
	}
): Promise<void> {
	if (scriptLoaders.has(src)) {
		return scriptLoaders.get(src)!;
	}

	if (document.querySelector(`script[src="${src}"]`)) {
		const resolved = Promise.resolve();
		scriptLoaders.set(src, resolved);
		return resolved;
	}

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
