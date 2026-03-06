<script lang="ts">
	import type { OutputLayoutItem } from '$lib/types/generated';
	import type { FileData } from 'selva-compute';
	import { downloadFiles, formatFileSize, getBase64FileSize } from '$lib/utils/file-download';
	import { Button } from '../ui';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Info } from '@lucide/svelte';
	import { Label } from '$lib/components/ui/label';

	interface Props {
		item: OutputLayoutItem;
		value: any;
		displayName?: string;
	}

	let { item, value, displayName }: Props = $props();

	// --- text/number state ---
	let copied = $state(false);
	let copyTimeout: ReturnType<typeof setTimeout>;

	const label = $derived(displayName || item.displayName || item.paramId);
	const isObjectValue = $derived(typeof value === 'object' && value !== null);
	const formattedValue = $derived(
		value == null ? '' : isObjectValue ? JSON.stringify(value, null, 2) : String(value)
	);
	const hasValue = $derived(value != null);

	const boxClass = 'min-h-12.5 rounded px-3 py-3 font-mono text-sm border border-border';

	async function copyToClipboard() {
		try {
			await navigator.clipboard.writeText(formattedValue);
			copied = true;
			clearTimeout(copyTimeout);
			copyTimeout = setTimeout(() => (copied = false), 2000);
		} catch (err) {
			console.error('Failed to copy:', err);
		}
	}

	// --- file state ---
	let downloading = $state(false);
	let downloadError = $state<string | null>(null);

	function isFileData(data: any): data is FileData {
		return data && typeof data === 'object' && 'fileName' in data && 'data' in data;
	}

	const filesArray = $derived(
		!value ? [] : Array.isArray(value) ? value.filter(isFileData) : isFileData(value) ? [value] : []
	);
	const fileCount = $derived(filesArray.length);
	const totalSize = $derived(filesArray.reduce((sum, f) => sum + getBase64FileSize(f.data), 0));

	async function handleDownload() {
		if (fileCount === 0) return;
		downloading = true;
		downloadError = null;
		try {
			if (fileCount === 1) {
				await downloadFiles(filesArray[0], filesArray[0].fileName);
			} else {
				const fileName = displayName
					? displayName.replace(/[^a-z0-9]/gi, '_').toLowerCase()
					: 'download';
				await downloadFiles(filesArray, fileName);
			}
		} catch (err) {
			downloadError = err instanceof Error ? err.message : 'Failed to download files';
			console.error('[OutputDisplayWidget] Download error:', err);
		} finally {
			downloading = false;
		}
	}
</script>

{#snippet fieldHeader()}
	<div class="gap-2 flex items-center">
		<Label>{label}</Label>
		{#if item.description}
			<Dialog.Root>
				<Dialog.Trigger class="p-1 cursor-help opacity-60 transition-opacity hover:opacity-100">
					<Info size={16} />
				</Dialog.Trigger>
				<Dialog.Content class="sm:max-w-md">
					<Dialog.Header>
						<Dialog.Title>{label}</Dialog.Title>
						<Dialog.Description>{item.description}</Dialog.Description>
					</Dialog.Header>
				</Dialog.Content>
			</Dialog.Root>
		{/if}
	</div>
{/snippet}

{#snippet placeholder()}
	<span class="text-muted-foreground not-italic">Waiting for data...</span>
{/snippet}

{#snippet fileDisplay()}
	{#if fileCount === 0}
		<div class="rounded px-3 py-3 text-sm border border-border bg-muted text-muted-foreground">
			Waiting for file data...
		</div>
	{:else}
		<div class="gap-2 flex flex-col">
			<div class="rounded px-3 py-2 border border-border bg-muted">
				<div class="flex items-center justify-between">
					<span class="text-sm font-medium text-foreground">
						{fileCount === 1
							? `${filesArray[0].fileName}${filesArray[0].fileType}`
							: `${fileCount} files`}
					</span>
					<span class="text-xs text-muted-foreground">{formatFileSize(totalSize)}</span>
				</div>
				{#if fileCount > 1}
					<div class="mt-2 gap-1 flex flex-col">
						{#each filesArray as file (file.fileName)}
							<div class="text-xs flex items-center justify-between text-muted-foreground">
								<span>{file.fileName}{file.fileType}</span>
								<span>{formatFileSize(getBase64FileSize(file.data))}</span>
							</div>
						{/each}
					</div>
				{/if}
			</div>
			{#if downloadError}
				<div
					class="rounded px-3 py-2 text-sm border border-destructive bg-destructive/10 text-destructive"
				>
					{downloadError}
				</div>
			{/if}
			<Button onclick={handleDownload} disabled={downloading} class="w-full">
				{downloading
					? 'Downloading...'
					: `Download ${fileCount === 1 ? 'File' : `${fileCount} Files`}`}
			</Button>
		</div>
	{/if}
{/snippet}

<div class="gap-2 flex flex-col">
	{@render fieldHeader()}

	{#if item.widgetType === 'file'}
		{@render fileDisplay()}
	{:else if item.widgetType === 'number'}
		<div class="{boxClass} bg-muted/50 wrap-break-word">
			{#if hasValue}
				<span class="font-bold text-primary">{formattedValue}</span>
			{:else}
				{@render placeholder()}
			{/if}
		</div>
	{:else if item.widgetType === 'text'}
		<div class="group relative">
			{#if isObjectValue}
				<pre
					class="{boxClass} overflow-wrap-anywhere max-h-96 overflow-auto bg-muted/10 text-foreground">{formattedValue}</pre>
			{:else}
				<div
					class="{boxClass} overflow-wrap-anywhere bg-muted/10 wrap-break-word whitespace-pre-wrap text-foreground"
				>
					{#if hasValue}{value}{:else}{@render placeholder()}{/if}
				</div>
			{/if}
			{#if hasValue}
				<Button
					onclick={copyToClipboard}
					class="right-2 top-2 absolute transition-opacity {copied
						? 'opacity-100'
						: 'opacity-0 group-hover:opacity-100'}"
					size="sm"
				>
					{copied ? 'Copied!' : 'Copy'}
				</Button>
			{/if}
		</div>
	{/if}
</div>
