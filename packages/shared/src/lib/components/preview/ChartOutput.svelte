<script lang="ts">
	import type { OutputChartLayoutItem } from '$lib/types/generated';
	import { onMount } from 'svelte';
	import { Loader, Maximize, Minimize } from '@lucide/svelte';
	import { Label } from '$lib/components/ui/label';

	interface Props {
		item: OutputChartLayoutItem;
		value: string;
	}

	let { item, value }: Props = $props();

	const MAP_TYPE_SET = new Set(['scattermap', 'scattermapbox', 'choropleth', 'scattergeo']);

	// ── Figure parsing ──────────────────────────────────────────────────

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

	const figTitle = $derived.by(() => {
		if (!figData) return null;
		const t = figData.layout?.title;
		if (!t) return null;
		if (typeof t === 'string') return t;
		if (typeof t === 'object' && 'text' in t) return (t as Record<string, unknown>).text as string;
		return null;
	});

	// ── DOM refs & state ────────────────────────────────────────────────

	let containerEl = $state<HTMLDivElement | null>(null);
	let wrapperEl = $state<HTMLDivElement | null>(null);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let isFullscreen = $state(false);
	let mounted = false;

	// ── Plotly loader (deduplicated) ────────────────────────────────────

	let plotlyPromise: Promise<any> | null = null;

	async function loadPlotly(): Promise<any> {
		// @ts-expect-error — Plotly is loaded dynamically onto window
		if (window.Plotly) return window.Plotly;
		if (!plotlyPromise) {
			plotlyPromise = new Promise<void>((resolve, reject) => {
				const script = document.createElement('script');
				script.src = 'https://cdn.plot.ly/plotly-3.4.0.min.js';
				script.crossOrigin = 'anonymous';
				script.onload = () => resolve();
				script.onerror = () => {
					plotlyPromise = null;
					reject(new Error('Failed to load Plotly'));
				};
				document.head.appendChild(script);
				// @ts-expect-error — Plotly is loaded dynamically onto window
			}).then(() => window.Plotly);
		}
		return plotlyPromise;
	}

	// ── Fullscreen ──────────────────────────────────────────────────────

	function toggleFullscreen() {
		if (!wrapperEl) return;
		if (!document.fullscreenElement) {
			wrapperEl.requestFullscreen();
		} else {
			document.exitFullscreen();
		}
	}

	$effect(() => {
		function onFullscreenChange() {
			isFullscreen = !!document.fullscreenElement;
			setTimeout(() => {
				// @ts-expect-error — Plotly is loaded dynamically onto window
				if (containerEl && window.Plotly) window.Plotly.Plots.resize(containerEl);
			}, 100);
		}
		document.addEventListener('fullscreenchange', onFullscreenChange);
		return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
	});

	// ── Theme-aware colors ──────────────────────────────────────────────

	function getThemeColors(): { textColor: string; gridColor: string } {
		if (!containerEl) return { textColor: '#333', gridColor: '#eee' };
		const style = getComputedStyle(containerEl);
		const textColor = style.getPropertyValue('color').trim() || '#333';
		const gridColor =
			style.getPropertyValue('--border')?.trim() ||
			style.getPropertyValue('--color-border')?.trim() ||
			'rgba(128,128,128,0.2)';
		return { textColor, gridColor };
	}

	// ── Render ──────────────────────────────────────────────────────────

	async function renderChart() {
		if (!containerEl || !figData) return;
		error = null;
		loading = true;
		try {
			const Plotly = await loadPlotly();
			const { textColor, gridColor } = getThemeColors();
			const isMapFigure = figData.data?.some((t) => MAP_TYPE_SET.has(t.type as string));

			// Strip title, template, and explicit sizing
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
				...(!isMapFigure && layoutRest.xaxis
					? { xaxis: { ...(layoutRest.xaxis as object), gridcolor: gridColor, color: textColor } }
					: {}),
				...(!isMapFigure && layoutRest.yaxis
					? { yaxis: { ...(layoutRest.yaxis as object), gridcolor: gridColor, color: textColor } }
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
			error = e instanceof Error ? e.message : 'Failed to render chart';
		} finally {
			loading = false;
		}
	}

	// ── Lifecycle ───────────────────────────────────────────────────────

	onMount(() => {
		mounted = true;

		let resizeTimer: ReturnType<typeof setTimeout>;
		const ro = new ResizeObserver(() => {
			clearTimeout(resizeTimer);
			resizeTimer = setTimeout(() => {
				// @ts-expect-error — Plotly is loaded dynamically onto window
				if (containerEl && window.Plotly) window.Plotly.Plots.resize(containerEl);
			}, 150);
		});
		if (containerEl) ro.observe(containerEl);

		return () => {
			ro.disconnect();
			clearTimeout(resizeTimer);
			// @ts-expect-error — Plotly is loaded dynamically onto window
			if (containerEl && window.Plotly) window.Plotly.purge(containerEl);
		};
	});

	// ── Debounced re-render on value change ─────────────────────────────

	let renderTimeout: ReturnType<typeof setTimeout>;

	$effect(() => {
		if (!value || !mounted || !containerEl) return;
		clearTimeout(renderTimeout);
		renderTimeout = setTimeout(() => renderChart(), 150);
		return () => clearTimeout(renderTimeout);
	});
</script>

<div
	bind:this={wrapperEl}
	class="gap-0 flex flex-col overflow-hidden rounded-lg border border-border {isFullscreen
		? 'bg-background'
		: ''}"
>
	<!-- Header: title + controls -->
	<div class="gap-2 px-3 py-1.5 relative z-10 flex items-center border-b border-border bg-muted/40">
		<Label class="text-xs font-medium truncate text-foreground">
			{figTitle ?? item.displayName ?? item.paramId}
		</Label>

		<div class="gap-1 ml-auto flex items-center">
			{#if loading}
				<div class="text-muted-foreground">
					<Loader size={12} class="animate-spin" />
				</div>
			{/if}

			<button
				onclick={toggleFullscreen}
				title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
				class="rounded p-1 flex items-center text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground"
			>
				{#if isFullscreen}
					<Minimize size={14} />
				{:else}
					<Maximize size={14} />
				{/if}
			</button>
		</div>
	</div>

	{#if error}
		<div class="px-4 py-3 text-sm text-destructive">{error}</div>
	{:else if !figData && value}
		<div class="px-4 py-8 text-sm text-center text-muted-foreground">Receiving chart data...</div>
	{:else if !figData}
		<div class="px-4 py-8 text-sm text-center text-muted-foreground">Waiting for chart data...</div>
	{:else}
		<div
			bind:this={containerEl}
			class="w-full"
			style="height: {isFullscreen ? 'calc(100vh - 36px)' : '380px'};"
		></div>
	{/if}
</div>
