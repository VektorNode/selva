<script lang="ts">
	import type { OutputImageLayoutItem } from '@selvajs/schemas';
	import type { FileData } from '@selvajs/compute/core';
	import {
		ChevronLeft,
		ChevronRight,
		Download,
		Maximize,
		Minimize,
		Scan,
		ZoomIn,
		ZoomOut
	} from '@lucide/svelte';
	import { downloadFiles, isFileData, MIME_BY_EXT } from '$lib/utils/file-download';

	interface Props {
		item: OutputImageLayoutItem;
		value: unknown;
	}

	let { item, value }: Props = $props();

	const SUPPORTED_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']);
	const ZOOM_STEP = 1.5;
	const MAX_ZOOM_OVER_NATURAL = 32;
	// Above this many screen pixels per image pixel, smoothing hides exactly the detail the user
	// zoomed in to see, so raster images switch to nearest-neighbour.
	const PIXELATED_FROM_SCALE = 2;

	const extOf = (f: FileData) => (f.fileType ?? '').toLowerCase();

	const files = $derived.by<FileData[]>(() => {
		if (Array.isArray(value)) return value.filter(isFileData);
		return isFileData(value) ? [value] : [];
	});
	const images = $derived(files.filter((f) => SUPPORTED_EXTS.has(extOf(f))));
	const unsupported = $derived(images.length === 0 ? files[0] : undefined);

	let index = $state(0);
	const currentIndex = $derived(Math.max(0, Math.min(index, images.length - 1)));
	const current = $derived(images[currentIndex] ?? null);
	const isSvg = $derived(current ? extOf(current) === '.svg' : false);

	// Binary formats (PNG/JPG/WEBP/GIF) arrive base64; SVG arrives as plain UTF-8 XML
	// and must be percent-encoded into the data URL.
	// Rendering through <img src> rather than inlining the SVG is a security choice:
	// browsers disable scripting in image-context SVGs, so untrusted SVG cannot
	// execute against the host. Don't switch to {@html} or an inline <svg>.
	function toDataUrl(file: FileData): string {
		const mime = MIME_BY_EXT[extOf(file)] ?? 'application/octet-stream';
		if (file.isBase64Encoded) return `data:${mime};base64,${file.data}`;
		return `data:${mime};utf8,${encodeURIComponent(file.data)}`;
	}

	const dataUrl = $derived(current ? toDataUrl(current) : null);

	const cfg = $derived(item.config ?? {});
	const allowDownload = $derived(cfg.allowDownload ?? true);
	const allowFullscreen = $derived(cfg.allowFullscreen ?? true);
	const backgroundColor = $derived(cfg.backgroundColor);

	let wrapperEl = $state<HTMLDivElement | null>(null);
	let stageEl = $state<HTMLDivElement | null>(null);
	let isFullscreen = $state(false);
	let downloading = $state(false);
	let error = $state<string | null>(null);
	let decodeFailed = $state(false);

	// View state. `scale` is screen px per image px; (x, y) is the image's top-left in stage px.
	// The image is sized with width/height rather than a CSS transform so the browser re-rasters
	// SVGs and resamples bitmaps at the displayed size instead of stretching a cached layer.
	let stageW = $state(0);
	let stageH = $state(0);
	let naturalW = $state(0);
	let naturalH = $state(0);
	let scale = $state(1);
	let x = $state(0);
	let y = $state(0);
	let fitted = $state(true);

	const ready = $derived(naturalW > 0 && naturalH > 0 && stageW > 0 && stageH > 0);
	const fitScale = $derived(ready ? Math.min(stageW / naturalW, stageH / naturalH) : 1);
	const minScale = $derived(Math.min(fitScale, 1));
	const maxScale = $derived(Math.max(fitScale, 1) * MAX_ZOOM_OVER_NATURAL);
	const zoomPercent = $derived(Math.round(scale * 100));
	const pannable = $derived(naturalW * scale > stageW + 1 || naturalH * scale > stageH + 1);
	const pixelated = $derived(!isSvg && scale >= PIXELATED_FROM_SCALE);

	function clampAxis(pos: number, size: number, stage: number) {
		if (size <= stage) return (stage - size) / 2;
		return Math.min(0, Math.max(stage - size, pos));
	}

	function applyView(nextScale: number, nextX: number, nextY: number) {
		scale = nextScale;
		x = clampAxis(nextX, naturalW * nextScale, stageW);
		y = clampAxis(nextY, naturalH * nextScale, stageH);
	}

	function fit() {
		fitted = true;
		applyView(fitScale, 0, 0);
	}

	function zoomTo(target: number, px = stageW / 2, py = stageH / 2) {
		const next = Math.min(maxScale, Math.max(minScale, target));
		const ratio = next / scale;
		fitted = Math.abs(next - fitScale) < 1e-3;
		applyView(next, px - (px - x) * ratio, py - (py - y) * ratio);
	}

	// Refit on stage resize (fullscreen, layout changes) unless the user has zoomed in.
	$effect(() => {
		if (!stageEl) return;
		const ro = new ResizeObserver(([entry]) => {
			stageW = entry.contentRect.width;
			stageH = entry.contentRect.height;
			if (fitted) fit();
			else applyView(Math.max(scale, minScale), x, y);
		});
		ro.observe(stageEl);
		return () => ro.disconnect();
	});

	function onImageLoad(e: Event) {
		const img = e.currentTarget as HTMLImageElement;
		decodeFailed = false;
		// A viewBox-only SVG can report 0×0; fall back to the browser's default replaced-element size.
		const w = img.naturalWidth || 300;
		const h = img.naturalHeight || 150;
		// Keep the zoom across solves when the new image has the same size: the user is usually
		// watching one detail change as they move a slider.
		const sameSize = w === naturalW && h === naturalH;
		naturalW = w;
		naturalH = h;
		if (!sameSize || fitted) fit();
	}

	// ---- pointer: drag to pan, two fingers to pinch -------------------------------------------
	// Not reactive state: only read inside handlers.
	const pointers: Record<number, { x: number; y: number }> = {};
	const pointerList = () => Object.values(pointers);
	let dragging = $state(false);
	let pinchDistance = 0;

	function stagePoint(e: { clientX: number; clientY: number }) {
		const r = stageEl!.getBoundingClientRect();
		return { x: e.clientX - r.left, y: e.clientY - r.top };
	}

	function onPointerDown(e: PointerEvent) {
		if (e.button !== 0 || (e.target as Element).closest('button')) return;
		stageEl?.setPointerCapture(e.pointerId);
		pointers[e.pointerId] = stagePoint(e);
		const count = pointerList().length;
		dragging = count === 1 && pannable;
		if (count === 2) {
			const [a, b] = pointerList();
			pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
		}
	}

	function onPointerMove(e: PointerEvent) {
		const prev = pointers[e.pointerId];
		if (!prev) return;
		const p = stagePoint(e);
		pointers[e.pointerId] = p;

		if (pointerList().length === 2) {
			const [a, b] = pointerList();
			const distance = Math.hypot(a.x - b.x, a.y - b.y);
			if (pinchDistance > 0)
				zoomTo(scale * (distance / pinchDistance), (a.x + b.x) / 2, (a.y + b.y) / 2);
			pinchDistance = distance;
		} else if (dragging) {
			fitted = false;
			applyView(scale, x + p.x - prev.x, y + p.y - prev.y);
		}
	}

	function onPointerUp(e: PointerEvent) {
		delete pointers[e.pointerId];
		const count = pointerList().length;
		if (count < 2) pinchDistance = 0;
		if (count === 0) dragging = false;
	}

	function onDoubleClick(e: MouseEvent) {
		if (!fitted) return fit();
		const p = stagePoint(e);
		// Large images go to 1:1 (true pixels); small ones are already ≥1:1 when fitted, so magnify.
		zoomTo(fitScale < 0.8 ? 1 : fitScale * 3, p.x, p.y);
	}

	// ---- wheel: zoom on Ctrl/⌘ (and trackpad pinch, which sends ctrlKey) or in fullscreen -------
	let showWheelHint = $state(false);
	let wheelHintTimeout: ReturnType<typeof setTimeout>;

	// Registered by hand: preventDefault needs a non-passive listener.
	$effect(() => {
		if (!stageEl) return;
		const el = stageEl;
		function onWheel(e: WheelEvent) {
			if (!ready) return;
			if (!(e.ctrlKey || e.metaKey || isFullscreen)) {
				// Let the page scroll, but say how to zoom.
				showWheelHint = true;
				clearTimeout(wheelHintTimeout);
				wheelHintTimeout = setTimeout(() => (showWheelHint = false), 1200);
				return;
			}
			e.preventDefault();
			showWheelHint = false;
			const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
			const p = stagePoint(e);
			zoomTo(scale * Math.exp(-delta * 0.002), p.x, p.y);
		}
		el.addEventListener('wheel', onWheel, { passive: false });
		return () => {
			el.removeEventListener('wheel', onWheel);
			clearTimeout(wheelHintTimeout);
		};
	});

	function onKeyDown(e: KeyboardEvent) {
		const actions: Record<string, () => void> = {
			'+': () => zoomTo(scale * ZOOM_STEP),
			'=': () => zoomTo(scale * ZOOM_STEP),
			'-': () => zoomTo(scale / ZOOM_STEP),
			'0': fit,
			'1': () => zoomTo(1),
			ArrowLeft: () => step(-1),
			ArrowRight: () => step(1)
		};
		if (allowFullscreen) actions.f = toggleFullscreen;
		const action = actions[e.key];
		if (!action) return;
		e.preventDefault();
		action();
	}

	function step(delta: number) {
		if (images.length < 2) return;
		select((currentIndex + delta + images.length) % images.length);
	}

	function select(i: number) {
		if (i === currentIndex) return;
		index = i;
		// A different image in the set: start fitted rather than carrying over the old zoom.
		naturalW = 0;
		naturalH = 0;
		fitted = true;
	}

	function toggleFullscreen() {
		if (!wrapperEl) return;
		if (!document.fullscreenElement) {
			wrapperEl.requestFullscreen().catch((err) => {
				error = `Fullscreen unavailable: ${err.message}`;
			});
		} else {
			document.exitFullscreen().catch((err) => {
				error = `Exit fullscreen failed: ${err.message}`;
			});
		}
	}

	$effect(() => {
		function onFullscreenChange() {
			isFullscreen = document.fullscreenElement === wrapperEl;
		}
		document.addEventListener('fullscreenchange', onFullscreenChange);
		return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
	});

	async function handleDownload() {
		if (!current) return;
		downloading = true;
		error = null;
		try {
			await downloadFiles(current, current.fileName);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Download failed';
		} finally {
			downloading = false;
		}
	}

	const toolButton =
		'flex h-7 min-w-7 items-center justify-center rounded px-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40';
</script>

<div
	bind:this={wrapperEl}
	class="rounded flex flex-col overflow-hidden border border-border bg-background {isFullscreen
		? 'h-screen'
		: ''}"
>
	{#if error}
		<div class="px-4 py-3 text-sm text-destructive">{error}</div>
	{:else if unsupported}
		<div class="px-4 py-3 text-sm text-destructive">
			Unsupported image format: <span class="font-mono">{extOf(unsupported) || '(unknown)'}</span>.
			Supported: .png, .jpg, .jpeg, .webp, .gif, .svg
		</div>
	{:else if !current}
		<div class="px-4 py-8 text-sm text-center text-muted-foreground">Waiting for image...</div>
	{:else}
		<!-- The stage is a pan/zoom surface with its own keyboard shortcuts; no native element fits. -->
		<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
		<div
			bind:this={stageEl}
			role="application"
			aria-roledescription="image viewer"
			aria-label={item.displayName ?? current.fileName}
			tabindex="0"
			class="relative w-full overflow-hidden outline-none select-none focus-visible:ring-2 focus-visible:ring-ring
				{isFullscreen ? 'flex-1' : 'h-95'}
				{dragging ? 'cursor-grabbing' : pannable ? 'cursor-grab' : 'cursor-zoom-in'}
				{fitted ? 'touch-pan-y' : 'touch-none'}
				{backgroundColor ? 'bg-(--image-bg)' : 'checkerboard'}"
			style:--image-bg={backgroundColor}
			onpointerdown={onPointerDown}
			onpointermove={onPointerMove}
			onpointerup={onPointerUp}
			onpointercancel={onPointerUp}
			ondblclick={onDoubleClick}
			onkeydown={onKeyDown}
		>
			{#if decodeFailed}
				<div class="inset-0 text-sm absolute flex items-center justify-center text-destructive">
					Couldn't decode {current.fileName}{current.fileType}
				</div>
			{:else}
				<img
					src={dataUrl}
					alt=""
					draggable="false"
					onload={onImageLoad}
					onerror={() => (decodeFailed = true)}
					class="absolute top-(--img-y) left-(--img-x) h-(--img-h) w-(--img-w) max-w-none
						{pixelated ? 'pixelated' : ''}
						{ready ? '' : 'invisible'}"
					style:--img-x="{x}px"
					style:--img-y="{y}px"
					style:--img-w="{naturalW * scale}px"
					style:--img-h="{naturalH * scale}px"
				/>
			{/if}

			{#if images.length > 1}
				<button
					onclick={() => step(-1)}
					title="Previous image (←)"
					class="left-2 p-1.5 backdrop-blur-sm absolute top-1/2 -translate-y-1/2 rounded-full border border-border bg-background/80 text-foreground hover:bg-background"
				>
					<ChevronLeft size={16} />
				</button>
				<button
					onclick={() => step(1)}
					title="Next image (→)"
					class="right-2 p-1.5 backdrop-blur-sm absolute top-1/2 -translate-y-1/2 rounded-full border border-border bg-background/80 text-foreground hover:bg-background"
				>
					<ChevronRight size={16} />
				</button>
			{/if}

			<div
				class="px-2.5 py-1 text-xs bottom-2 rounded pointer-events-none absolute left-1/2 -translate-x-1/2 bg-foreground/80 text-background transition-opacity {showWheelHint
					? 'opacity-100'
					: 'opacity-0'}"
			>
				Hold Ctrl or ⌘ and scroll to zoom
			</div>
		</div>

		{#if images.length > 1}
			<div class="gap-1.5 p-1.5 flex overflow-x-auto border-t border-border">
				{#each images as image, i (i)}
					<button
						onclick={() => select(i)}
						title="{image.fileName}{image.fileType}"
						class="h-12 w-16 rounded shrink-0 overflow-hidden border-2 bg-muted transition-colors {i ===
						currentIndex
							? 'border-primary'
							: 'border-transparent opacity-70 hover:opacity-100'}"
					>
						<img src={toDataUrl(image)} alt="" class="h-full w-full object-contain" />
					</button>
				{/each}
			</div>
		{/if}

		<div class="gap-2 px-2 py-1 text-xs flex items-center border-t border-border">
			<div class="min-w-0 gap-1.5 flex flex-1 items-center text-muted-foreground">
				<span class="truncate text-foreground">{current.fileName}{current.fileType}</span>
				{#if ready}
					<span class="shrink-0 tabular-nums">{naturalW}×{naturalH}</span>
				{/if}
			</div>

			<div class="gap-0.5 flex shrink-0 items-center">
				<button
					class={toolButton}
					onclick={() => zoomTo(scale / ZOOM_STEP)}
					disabled={!ready || scale <= minScale + 1e-3}
					title="Zoom out (−)"
				>
					<ZoomOut size={14} />
				</button>
				<span class="w-11 text-center text-muted-foreground tabular-nums">{zoomPercent}%</span>
				<button
					class={toolButton}
					onclick={() => zoomTo(scale * ZOOM_STEP)}
					disabled={!ready || scale >= maxScale - 1e-3}
					title="Zoom in (+)"
				>
					<ZoomIn size={14} />
				</button>
				<button class={toolButton} onclick={fit} disabled={!ready || fitted} title="Fit (0)">
					<Scan size={14} />
				</button>
				<button
					class="{toolButton} font-medium tabular-nums"
					onclick={() => zoomTo(1)}
					disabled={!ready || Math.abs(scale - 1) < 1e-3}
					title="Actual pixels (1)"
				>
					1:1
				</button>

				{#if allowDownload || allowFullscreen}
					<div class="mx-1 h-4 w-px bg-border"></div>
				{/if}
				{#if allowDownload}
					<button
						class={toolButton}
						onclick={handleDownload}
						disabled={downloading}
						title="Download image"
					>
						<Download size={14} />
					</button>
				{/if}
				{#if allowFullscreen}
					<button
						class={toolButton}
						onclick={toggleFullscreen}
						title={isFullscreen ? 'Exit fullscreen (F)' : 'Fullscreen (F)'}
					>
						{#if isFullscreen}
							<Minimize size={14} />
						{:else}
							<Maximize size={14} />
						{/if}
					</button>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	/* Shows transparency in PNG/WebP/SVG output instead of blending it into the page. */
	.checkerboard {
		background: repeating-conic-gradient(var(--muted) 0 25%, transparent 0 50%) 0 0 / 16px 16px;
	}
	.pixelated {
		image-rendering: pixelated;
	}
</style>
