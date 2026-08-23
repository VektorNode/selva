<script lang="ts">
	import type { OutputImageLayoutItem } from '@selvajs/schemas';
	import type { FileData } from '@selvajs/compute/core';
	import { Download, Maximize, Minimize } from '@lucide/svelte';
	import { downloadFiles, isFileData, MIME_BY_EXT } from '$lib/utils/file-download';

	interface Props {
		item: OutputImageLayoutItem;
		value: unknown;
	}

	let { item, value }: Props = $props();

	const SUPPORTED_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']);

	const file = $derived.by<FileData | null>(() => {
		if (Array.isArray(value)) return value.find(isFileData) ?? null;
		return isFileData(value) ? value : null;
	});

	const ext = $derived(file ? (file.fileType ?? '').toLowerCase() : '');
	const isSupported = $derived(SUPPORTED_EXTS.has(ext));

	// Binary formats (PNG/JPG/WEBP/GIF) arrive base64; SVG arrives as plain UTF-8 XML
	// and must be percent-encoded into the data URL.
	// Rendering through <img src> rather than inlining the SVG is a security choice:
	// browsers disable scripting in image-context SVGs, so untrusted SVG cannot
	// execute against the host. Don't switch to {@html} or an inline <svg>.
	const dataUrl = $derived.by(() => {
		if (!file || !isSupported) return null;
		const mime = MIME_BY_EXT[ext] ?? 'application/octet-stream';
		if (file.isBase64Encoded) {
			return `data:${mime};base64,${file.data}`;
		}
		return `data:${mime};utf8,${encodeURIComponent(file.data)}`;
	});

	const cfg = $derived(item.config ?? {});
	const allowDownload = $derived(cfg.allowDownload ?? true);
	const allowFullscreen = $derived(cfg.allowFullscreen ?? true);
	const backgroundColor = $derived(cfg.backgroundColor);

	let wrapperEl = $state<HTMLDivElement | null>(null);
	let isFullscreen = $state(false);
	let downloading = $state(false);
	let error = $state<string | null>(null);

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
			isFullscreen = !!document.fullscreenElement;
		}
		document.addEventListener('fullscreenchange', onFullscreenChange);
		return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
	});

	async function handleDownload() {
		if (!file) return;
		downloading = true;
		error = null;
		try {
			await downloadFiles(file, file.fileName);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Download failed';
		} finally {
			downloading = false;
		}
	}
</script>

<div
	bind:this={wrapperEl}
	class="group rounded relative overflow-hidden border border-border {isFullscreen
		? 'bg-background'
		: ''}"
>
	{#if error}
		<div class="px-4 py-3 text-sm text-destructive">{error}</div>
	{:else if !file}
		<div class="px-4 py-8 text-sm text-center text-muted-foreground">Waiting for image...</div>
	{:else if !isSupported}
		<div class="px-4 py-3 text-sm text-destructive">
			Unsupported image format: <span class="font-mono">{ext || '(unknown)'}</span>. Supported:
			.png, .jpg, .jpeg, .webp, .gif, .svg
		</div>
	{:else}
		<div
			class="w-full"
			style="height: {isFullscreen ? '100vh' : '380px'}; {backgroundColor
				? `background-color: ${backgroundColor};`
				: ''}"
		>
			<img
				src={dataUrl}
				alt={item.displayName ?? file.fileName}
				class="h-full w-full object-contain"
			/>
		</div>

		{#if allowDownload || allowFullscreen}
			<div
				class="gap-1 right-2 top-2 absolute z-10 flex items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 {isFullscreen
					? 'opacity-100'
					: ''}"
			>
				{#if allowDownload && file}
					<button
						onclick={handleDownload}
						disabled={downloading}
						title="Download image"
						class="rounded p-1.5 backdrop-blur-sm flex items-center border border-border bg-background/80 text-foreground transition-colors hover:bg-background disabled:cursor-not-allowed disabled:opacity-50"
					>
						<Download size={14} />
					</button>
				{/if}

				{#if allowFullscreen}
					<button
						onclick={toggleFullscreen}
						title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
						class="rounded p-1.5 backdrop-blur-sm flex items-center border border-border bg-background/80 text-foreground transition-colors hover:bg-background"
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
	{/if}
</div>
