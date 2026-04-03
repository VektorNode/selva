<script lang="ts">
	import type { OutputChartLayoutItem } from '$lib/types/generated';
	import { onMount } from 'svelte';
	import {
		ChartLine,
		ChartColumn,
		ChartPie,
		ChartBar,
		Globe,
		Loader,
		Maximize,
		Minimize,
		Dot,
		TrendingUp,
		Activity
	} from '@lucide/svelte';
	import { Label } from '$lib/components/ui/label';
	import type { Component } from 'svelte';

	interface Props {
		item: OutputChartLayoutItem;
		value: string;
	}

	let { item, value }: Props = $props();

	// ── Chart type definitions ──────────────────────────────────────────

	const CHART_TYPES = ['scatter', 'bar', 'pie', 'histogram'] as const;
	const MAP_TYPES = ['scattermap', 'scattermapbox', 'choropleth', 'scattergeo'] as const;
	type ChartType = (typeof CHART_TYPES)[number];
	type SwitchableType = ChartType | 'map';
	type ScatterMode = 'markers' | 'lines' | 'lines+markers';

	const ALL_SCATTER_MODES: ScatterMode[] = ['markers', 'lines', 'lines+markers'];

	const TYPE_META: Record<SwitchableType, { label: string; icon: Component }> = {
		scatter: { label: 'Scatter', icon: ChartLine },
		bar: { label: 'Bar', icon: ChartColumn },
		pie: { label: 'Pie', icon: ChartPie },
		histogram: { label: 'Histogram', icon: ChartBar },
		map: { label: 'Map', icon: Globe }
	};

	const MODE_META: Record<ScatterMode, { label: string; icon: Component }> = {
		markers: { label: 'Scatter', icon: Dot },
		lines: { label: 'Line', icon: TrendingUp },
		'lines+markers': { label: 'Line+Points', icon: Activity }
	};

	const XY_TYPES = new Set(['scatter', 'bar', 'pie', 'histogram', 'scattergl']);
	const MAP_TYPE_SET = new Set<string>(MAP_TYPES);

	const allowedTypes = $derived(
		(item.config?.allowedTypes as ChartType[] | undefined) ?? [...CHART_TYPES]
	);

	const allowedModes = $derived<ScatterMode[]>(
		(item.config?.allowedModes as ScatterMode[] | undefined) ?? ALL_SCATTER_MODES
	);

	// ── Figure parsing ──────────────────────────────────────────────────

	type PlotlyTrace = Record<string, unknown>;
	type PlotlyFigure = { data: PlotlyTrace[]; layout: Record<string, unknown> };

	const figData = $derived.by(() => {
		if (!value) return null;
		try {
			return JSON.parse(value) as PlotlyFigure;
		} catch {
			return null;
		}
	});

	const isMapFigure = $derived(
		figData?.data?.some((t) => MAP_TYPE_SET.has(t.type as string)) ?? false
	);
	const allTracesXY = $derived(
		figData?.data?.every((t) => XY_TYPES.has(t.type as string)) ?? false
	);
	// Whether the active type supports scatter modes (markers/lines)
	const showTypeSwitcher = $derived(allowedTypes.length > 1 && allTracesXY && !isMapFigure);

	// Detect the mode from the first trace's data for smart defaulting
	const figDataMode = $derived.by<ScatterMode>(() => {
		const m = figData?.data?.[0]?.mode as string | undefined;
		if (m === 'lines' || m === 'lines+markers' || m === 'markers') return m;
		// If no mode set but it's a scatter, infer from markers presence
		return 'markers';
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
	let activeType = $state<SwitchableType>('scatter');
	let activeMode = $state<ScatterMode>('markers');
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
		// Try common CSS variable names; fall back to a semi-transparent text color
		const gridColor =
			style.getPropertyValue('--border')?.trim() ||
			style.getPropertyValue('--color-border')?.trim() ||
			'rgba(128,128,128,0.2)';
		return { textColor, gridColor };
	}

	// ── Render ──────────────────────────────────────────────────────────

	async function renderChart(type: SwitchableType, mode: ScatterMode = activeMode) {
		if (!containerEl || !figData) return;
		error = null;
		loading = true;
		try {
			const Plotly = await loadPlotly();
			const { textColor, gridColor } = getThemeColors();

			// Build traces for the requested chart type
			let traces: PlotlyTrace[];
			if (!allTracesXY || type === 'map' || isMapFigure) {
				traces = figData.data;
			} else if (type === 'pie') {
				// For pie, merge multiple traces into one if needed
				if (figData.data.length === 1) {
					const t = figData.data[0];
					traces = [
						{
							...t,
							type: 'pie',
							labels: t.x,
							values: t.y,
							x: undefined,
							y: undefined,
							mode: undefined
						}
					];
				} else {
					// Multiple traces: use subplots via domain positioning
					const count = figData.data.length;
					traces = figData.data.map((t, i) => ({
						...t,
						type: 'pie',
						labels: t.x,
						values: t.y,
						x: undefined,
						y: undefined,
						mode: undefined,
						domain: {
							column: i % count
						},
						name: (t.name as string) || `Series ${i + 1}`
					}));
				}
			} else {
				// For scatter, apply the active mode override
				traces = figData.data.map((t) => ({
					...t,
					type,
					...(type === 'scatter' ? { mode } : {})
				}));
			}

			const transparent = item.config?.transparentBackground !== false;

			// Strip title, template, and explicit sizing — we control those ourselves
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
				...(transparent ? { paper_bgcolor: 'transparent', plot_bgcolor: 'transparent' } : {}),
				// Apply grid colors to axes if present
				...(layoutRest.xaxis
					? {
							xaxis: {
								...(layoutRest.xaxis as object),
								gridcolor: gridColor,
								color: textColor
							}
						}
					: {}),
				...(layoutRest.yaxis
					? {
							yaxis: {
								...(layoutRest.yaxis as object),
								gridcolor: gridColor,
								color: textColor
							}
						}
					: {})
			};

			// Grid layout for multiple pie charts
			if (type === 'pie' && figData.data.length > 1) {
				layout.grid = { rows: 1, columns: figData.data.length };
			}

			Plotly.react(containerEl, traces, layout, {
				responsive: true,
				displayModeBar: 'hover',
				displaylogo: false,
				modeBarButtonsToRemove: ['sendDataToCloud', 'lasso2d', 'select2d']
			});
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to render chart';
		} finally {
			loading = false;
		}
	}

	function switchType(type: SwitchableType) {
		activeType = type;
		renderChart(type, activeMode);
	}

	function switchMode(mode: ScatterMode) {
		activeMode = mode;
		renderChart(activeType, mode);
	}

	// ── Lifecycle ───────────────────────────────────────────────────────

	onMount(() => {
		// Determine initial chart type from figure data
		if (isMapFigure) {
			activeType = 'map';
		} else {
			const firstType = figData?.data?.[0]?.type as ChartType | undefined;
			if (firstType && allowedTypes.includes(firstType)) {
				activeType = firstType;
			} else if (allowedTypes.length > 0) {
				activeType = allowedTypes[0];
			}
		}

		// Determine initial mode: config override → data mode → first allowed mode
		const configDefault = item.config?.defaultMode as ScatterMode | undefined;
		if (configDefault && allowedModes.includes(configDefault)) {
			activeMode = configDefault;
		} else if (allowedModes.includes(figDataMode)) {
			activeMode = figDataMode;
		} else if (allowedModes.length > 0) {
			activeMode = allowedModes[0];
		}

		mounted = true;

		// ResizeObserver for responsive resizing
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
			// Purge Plotly instance to prevent memory leaks
			// @ts-expect-error — Plotly is loaded dynamically onto window
			if (containerEl && window.Plotly) window.Plotly.purge(containerEl);
		};
	});

	// ── Debounced re-render on value change ─────────────────────────────

	let renderTimeout: ReturnType<typeof setTimeout>;

	$effect(() => {
		// Track `value` to trigger reactivity
		if (!value || !mounted || !containerEl) return;
		clearTimeout(renderTimeout);
		renderTimeout = setTimeout(() => renderChart(activeType, activeMode), 150);
		return () => clearTimeout(renderTimeout);
	});
</script>

<div
	bind:this={wrapperEl}
	class="gap-0 flex flex-col overflow-hidden rounded-lg border border-border {isFullscreen
		? 'bg-background'
		: ''}"
>
	<!-- Header: title + type switcher -->
	<div class="gap-2 px-3 py-1.5 relative z-10 flex items-center border-b border-border bg-muted/40">
		<Label class="text-xs font-medium truncate text-foreground">
			{figTitle ?? item.displayName ?? item.paramId}
		</Label>

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

		<div class="gap-1 ml-auto flex items-center">
			{#if showTypeSwitcher}
				<div class="gap-0.5 flex items-center">
					{#each allowedTypes as type (type)}
						{@const meta = TYPE_META[type]}
						<button
							onclick={() => switchType(type)}
							title={meta.label}
							class="gap-1 rounded px-2 py-1 text-xs font-medium flex items-center transition-colors
								{activeType === type
								? 'shadow-sm bg-background text-foreground'
								: 'text-muted-foreground hover:bg-background/60 hover:text-foreground'}"
						>
							<meta.icon size={12} />
							{meta.label}
						</button>
					{/each}
				</div>
			{/if}

			{#if activeType === 'scatter' && allowedModes.length > 1 && allTracesXY && !isMapFigure}
				<div class="ml-1 h-4 w-px bg-border"></div>
				<div class="gap-0.5 flex items-center">
					{#each allowedModes as mode (mode)}
						{@const meta = MODE_META[mode]}
						<button
							onclick={() => switchMode(mode)}
							title={meta.label}
							class="gap-1 rounded px-2 py-1 text-xs font-medium flex items-center transition-colors
								{activeMode === mode
								? 'shadow-sm bg-background text-foreground'
								: 'text-muted-foreground hover:bg-background/60 hover:text-foreground'}"
						>
							<meta.icon size={12} />
							{meta.label}
						</button>
					{/each}
				</div>
			{/if}

			{#if loading}
				<div class="text-muted-foreground">
					<Loader size={12} class="animate-spin" />
				</div>
			{/if}
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
