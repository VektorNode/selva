<script lang="ts">
	import type { OutputChartLayoutItem } from '@selvajs/schemas';
	import { onMount, tick } from 'svelte';
	import { mode } from 'mode-watcher';
	import { Loader, Maximize, Minimize } from '@lucide/svelte';
	import { loadScript } from '$lib/utils/loadScript';
	import { getLocaleContext } from '$lib/i18n/localeContext.svelte';
	import { formatMessage } from '$lib/i18n/messages';

	interface Props {
		item: OutputChartLayoutItem;
		value: string;
	}

	let { item: _item, value }: Props = $props();

	const locale = getLocaleContext();
	const t = $derived(locale.messages);

	const MAP_TYPE_SET = new Set(['scattermap', 'scattermapbox', 'choropleth', 'scattergeo']);

	type PlotlyTrace = Record<string, unknown>;
	type PlotlyFigure = {
		data: PlotlyTrace[];
		layout: Record<string, unknown>;
		config?: Record<string, unknown>;
	};

	const figData = $derived.by(() => {
		if (!value) return null;
		try {
			return JSON.parse(value) as PlotlyFigure;
		} catch {
			return null;
		}
	});

	let containerEl = $state<HTMLDivElement | null>(null);
	let wrapperEl = $state<HTMLDivElement | null>(null);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let isFullscreen = $state(false);
	let mounted = false;

	async function loadPlotly(): Promise<any> {
		// @ts-expect-error — Plotly is loaded dynamically onto window
		if (window.Plotly) return window.Plotly;

		// Pinned by hash: the plugin's web UI runs this on the origin that holds its bridge secret.
		await loadScript('https://cdn.plot.ly/plotly-3.4.0.min.js', {
			crossOrigin: 'anonymous',
			integrity: 'sha384-pFOQ7loGBChmUyS4Tszy+he8OWeYkwTFjc2xii4aJUWWiGwf2u2OEc04T5iDRpMp'
		});
		// @ts-expect-error — Plotly is loaded dynamically onto window
		return window.Plotly;
	}

	// Some embedded WebViews (WKWebView in the Rhino panel) ship without the Fullscreen API at all.
	const fullscreenSupported = typeof document !== 'undefined' && !!document.fullscreenEnabled;

	// `Plots.resize()`/`relayout({autosize: true})` ask Plotly to re-measure the container itself,
	// which it silently fails to do across a Fullscreen transition — _fullLayout keeps the
	// pre-toggle width/height even though clientWidth/clientHeight are already correct. Passing
	// the measured size explicitly is the only call that actually takes.
	function resizeChart() {
		// @ts-expect-error — Plotly is loaded dynamically onto window
		if (!containerEl || !window.Plotly) return;
		const { width, height } = containerEl.getBoundingClientRect();
		if (width === 0 || height === 0) return;
		// @ts-expect-error — Plotly is loaded dynamically onto window
		window.Plotly.relayout(containerEl, { width, height });
	}

	function toggleFullscreen() {
		if (!wrapperEl) return;
		if (!document.fullscreenElement) {
			wrapperEl.requestFullscreen().catch((err) => {
				error = formatMessage(t.fullscreenUnavailable, { error: err.message });
			});
		} else {
			document.exitFullscreen().catch((err) => {
				error = formatMessage(t.exitFullscreenFailed, { error: err.message });
			});
		}
	}

	$effect(() => {
		function onFullscreenChange() {
			isFullscreen = !!document.fullscreenElement;
			// `tick()` waits for the h-dvh/h-95 class swap this state drives to actually reach the
			// DOM before resizeChart measures it.
			tick().then(resizeChart);
		}
		document.addEventListener('fullscreenchange', onFullscreenChange);
		return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
	});

	// Chromium's getComputedStyle returns color values in whatever function the CSS used to
	// declare them — oklch() here, since base.css's theme tokens are oklch(). Plotly's own color
	// parser doesn't recognize oklch() and silently falls back to its #444 default instead of
	// erroring, so every chart read dark axis text even in dark mode. `fillStyle` alone just
	// echoes the oklch() string back unconverted; actually rasterizing a pixel and reading its
	// bytes is what forces a real rgb() value Plotly can parse.
	function toRgb(cssColor: string): string {
		const canvas = document.createElement('canvas');
		canvas.width = 1;
		canvas.height = 1;
		const ctx = canvas.getContext('2d');
		if (!ctx) return cssColor;
		ctx.fillStyle = cssColor;
		ctx.fillRect(0, 0, 1, 1);
		const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
		return a === 255 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
	}

	function getThemeColors(): { textColor: string; gridColor: string } {
		if (!containerEl) return { textColor: '#333', gridColor: '#eee' };
		const style = getComputedStyle(containerEl);
		const textColor = toRgb(style.getPropertyValue('color').trim() || '#333');
		const gridColor = toRgb(
			style.getPropertyValue('--border')?.trim() ||
				style.getPropertyValue('--color-border')?.trim() ||
				'rgba(128,128,128,0.2)'
		);
		return { textColor, gridColor };
	}

	async function renderChart() {
		if (!containerEl || !figData) return;
		error = null;
		loading = true;
		try {
			const Plotly = await loadPlotly();
			const { textColor, gridColor } = getThemeColors();
			const isMapFigure = figData.data?.some((t) => MAP_TYPE_SET.has(t.type as string));

			const {
				title: _title,
				template: _template,
				height: _height,
				width: _width,
				...layoutRest
			} = figData.layout as Record<string, unknown> & {
				title?: unknown;
				template?: unknown;
				height?: unknown;
				width?: unknown;
			};

			const layout: Record<string, unknown> = {
				...layoutRest,
				autosize: true,
				margin: { t: 24, r: 8, b: 40, l: 60, pad: 0 },
				font: { color: textColor },
				paper_bgcolor: layoutRest.paper_bgcolor ?? 'transparent',
				plot_bgcolor: layoutRest.plot_bgcolor ?? 'transparent',
				// Plotly's axis tick/label color doesn't inherit the top-level `font.color`, so this
				// has to be set even when the figure's own JSON never declared an xaxis/yaxis —
				// which the mock's figures don't. Gating on `layoutRest.xaxis` existing left every
				// axis on Plotly's built-in #444 default, light or dark mode.
				...(!isMapFigure
					? {
							xaxis: { ...(layoutRest.xaxis as object), gridcolor: gridColor, color: textColor },
							yaxis: { ...(layoutRest.yaxis as object), gridcolor: gridColor, color: textColor }
						}
					: {})
			};

			Plotly.react(containerEl, figData.data, layout, {
				responsive: true,
				displayModeBar: 'hover',
				displaylogo: false,
				modeBarButtonsToRemove: ['sendDataToCloud', 'lasso2d', 'select2d'],
				...figData.config
			});
		} catch (e) {
			error = e instanceof Error ? e.message : t.chartRenderFailed;
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		mounted = true;

		let resizeTimer: ReturnType<typeof setTimeout> | null = null;
		const ro = new ResizeObserver(() => {
			if (resizeTimer) clearTimeout(resizeTimer);
			resizeTimer = setTimeout(() => {
				resizeChart();
				resizeTimer = null;
			}, 150);
		});
		if (wrapperEl) ro.observe(wrapperEl);

		return () => {
			ro.disconnect();
			if (resizeTimer) clearTimeout(resizeTimer);
			// @ts-expect-error — Plotly is loaded dynamically onto window
			if (containerEl && window.Plotly) window.Plotly.purge(containerEl);
		};
	});

	let renderTimeout: ReturnType<typeof setTimeout> | null = null;

	$effect(() => {
		// Re-reads mode.current so a theme toggle re-renders with the new axis/font colors —
		// getThemeColors() only reads the DOM once, at render time, and nothing else repaints an
		// already-drawn chart when the page's color scheme changes under it.
		void mode.current;
		if (!value || !mounted || !containerEl) return;
		if (renderTimeout) clearTimeout(renderTimeout);
		renderTimeout = setTimeout(() => {
			renderChart();
			renderTimeout = null;
		}, 150);
		return () => {
			if (renderTimeout) clearTimeout(renderTimeout);
		};
	});
</script>

<div
	bind:this={wrapperEl}
	class="group relative overflow-hidden rounded-lg border border-border {isFullscreen
		? 'bg-background'
		: ''}"
>
	{#if error}
		<div class="px-4 py-3 text-sm text-destructive">{error}</div>
	{:else if !figData}
		<!-- The layout hides this output while it has no data, so this is data that doesn't parse yet. -->
		<div class="px-4 py-8 text-sm text-center text-muted-foreground">{t.chartReceiving}</div>
	{:else}
		<div bind:this={containerEl} class="w-full {isFullscreen ? 'h-dvh' : 'h-95'}"></div>

		<div
			class="gap-1 left-2 top-2 absolute z-10 flex items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100 {isFullscreen
				? 'opacity-100'
				: ''}"
		>
			{#if loading}
				<div
					class="rounded p-1.5 backdrop-blur-sm flex items-center border border-border bg-background/80 text-muted-foreground"
				>
					<Loader size={14} class="animate-spin" />
				</div>
			{/if}

			{#if fullscreenSupported}
				<button
					onclick={toggleFullscreen}
					disabled={loading}
					title={isFullscreen ? t.exitFullscreen : t.fullscreen}
					aria-label={isFullscreen ? t.exitFullscreen : t.fullscreen}
					class="rounded p-1.5 backdrop-blur-sm flex items-center border border-border bg-background/80 text-foreground transition-colors hover:bg-background disabled:cursor-not-allowed disabled:opacity-50"
				>
					{#if isFullscreen}
						<Minimize size={14} />
					{:else}
						<Maximize size={14} />
					{/if}
				</button>
			{/if}
		</div>
	{/if}
</div>
