<script lang="ts">
	import type { OutputImageLayoutItem } from '@selvajs/schemas';
	import type { FileData } from '@selvajs/compute';
	import { Download, Maximize, Minimize } from '@lucide/svelte';
	import { Label } from '$lib/components/primitives/label';
	import { downloadFiles } from '$lib/utils/file-download';

	interface Props {
		item: OutputImageLayoutItem;
		value: unknown;
	}

	let { item, value }: Props = $props();

	const SUPPORTED_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']);
	const MIME_BY_EXT: Record<string, string> = {
		'.png': 'image/png',
		'.jpg': 'image/jpeg',
		'.jpeg': 'image/jpeg',
		'.webp': 'image/webp',
		'.gif': 'image/gif',
		'.svg': 'image/svg+xml'
	};

	function isFileData(x: unknown): x is FileData {
		return !!x && typeof x === 'object' && 'fileName' in x && 'data' in x && 'fileType' in x;
	}

	const file = $derived.by<FileData | null>(() => {
		if (Array.isArray(value)) return value.find(isFileData) ?? null;
		return isFileData(value) ? value : null;
	});

	const ext = $derived(file ? (file.fileType ?? '').toLowerCase() : '');
	const isSupported = $derived(SUPPORTED_EXTS.has(ext));

	// Build a data URL. Binary formats (PNG/JPG/WEBP/GIF) come through as base64;
	// SVG arrives as plain UTF-8 XML and must be percent-encoded into the data URL.
	// Using <img src="..."> isolates SVG scripts (browsers disable scripting in
	// image-context SVGs), so untrusted SVG content cannot execute against the host.
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
	const fitMode = $derived(cfg.fitMode ?? 'contain');
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
	class="gap-0 flex flex-col overflow-hidden rounded-lg border border-border {isFullscreen
		? 'bg-background'
		: ''}"
>
	<div class="gap-2 px-3 py-1.5 relative z-10 flex items-center border-b border-border bg-muted/40">
		<Label
			class="text-xs font-medium truncate text-foreground"
			title={item.displayName ?? item.paramId}
		>
			{item.displayName ?? item.paramId}
		</Label>

		<div class="gap-1 ml-auto flex items-center">
			{#if allowDownload && file}
				<button
					onclick={handleDownload}
					disabled={downloading}
					title="Download image"
					class="rounded p-1 flex items-center text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
				>
					<Download size={14} />
				</button>
			{/if}

			{#if allowFullscreen}
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
			{/if}
		</div>
	</div>

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
			style="height: {isFullscreen ? 'calc(100vh - 36px)' : '380px'}; {backgroundColor
				? `background-color: ${backgroundColor};`
				: ''}"
		>
			<img
				src={dataUrl}
				alt={item.displayName ?? file.fileName}
				class="h-full w-full"
				style="object-fit: {fitMode};"
			/>
		</div>
	{/if}
</div>
