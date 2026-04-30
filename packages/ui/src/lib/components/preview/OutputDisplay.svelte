<script lang="ts">
	import type { OutputLayoutItem } from '@selvajs/schemas';
	import type { FileData } from '@selvajs/compute';
	import ChartOutput from './ChartOutput.svelte';
	import ImageOutput from './ImageOutput.svelte';
	import { downloadFiles, formatFileSize, getBase64FileSize } from '$lib/utils/file-download';
	import { Button } from '../primitives';
	import * as Dialog from '$lib/components/primitives/dialog';
	import { Info, Folder, FolderOpen, FileIcon, ChevronRight } from '@lucide/svelte';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { Label } from '$lib/components/primitives/label';

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

	// --- folder tree ---
	type TreeNode =
		| { type: 'file'; file: FileData }
		| { type: 'folder'; name: string; children: SvelteMap<string, TreeNode> };

	function buildTree(files: FileData[]): SvelteMap<string, TreeNode> {
		const root = new SvelteMap<string, TreeNode>();
		for (const file of files) {
			const parts = (file.subFolder || '').split('/').filter(Boolean);
			let current = root;
			for (const part of parts) {
				if (!current.has(part)) {
					current.set(part, { type: 'folder', name: part, children: new SvelteMap() });
				}
				const node = current.get(part)!;
				if (node.type === 'folder') current = node.children;
			}
			current.set(file.fileName + file.fileType, { type: 'file', file });
		}
		return root;
	}

	function collectFolderPaths(nodes: Map<string, TreeNode>, prefix = ''): string[] {
		const paths: string[] = [];
		for (const [key, node] of nodes) {
			if (node.type === 'folder') {
				const path = prefix ? `${prefix}/${key}` : key;
				paths.push(path);
				paths.push(...collectFolderPaths(node.children, path));
			}
		}
		return paths;
	}

	const hasSubFolders = $derived(filesArray.some((f) => f.subFolder && f.subFolder.length > 0));
	const fileTree = $derived(hasSubFolders ? buildTree(filesArray) : null);

	// All folders expanded by default
	let expandedFolders = new SvelteSet<string>();

	$effect(() => {
		if (fileTree) {
			expandedFolders.clear();
			for (const path of collectFolderPaths(fileTree)) {
				expandedFolders.add(path);
			}
		}
	});

	function toggleFolder(path: string) {
		if (expandedFolders.has(path)) expandedFolders.delete(path);
		else expandedFolders.add(path);
	}

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

{#snippet treeNodes(nodes: Map<string, TreeNode>, path: string)}
	{#each nodes as [key, node] (key)}
		{#if node.type === 'folder'}
			{@const folderPath = path ? `${path}/${node.name}` : node.name}
			{@const isOpen = expandedFolders.has(folderPath)}
			<div>
				<button
					onclick={() => toggleFolder(folderPath)}
					class="gap-1.5 py-0.5 text-xs flex w-full items-center text-muted-foreground transition-colors hover:text-foreground"
				>
					<ChevronRight
						size={12}
						class="shrink-0 transition-transform duration-150 {isOpen ? 'rotate-90' : ''}"
					/>
					{#if isOpen}
						<FolderOpen size={13} class="shrink-0 text-primary/70" />
					{:else}
						<Folder size={13} class="shrink-0 text-primary/70" />
					{/if}
					<span class="font-medium">{node.name}</span>
				</button>
				{#if isOpen}
					<div class="ml-4 pl-2 border-l border-border/50">
						{@render treeNodes(node.children, folderPath)}
					</div>
				{/if}
			</div>
		{:else}
			<div class="gap-1.5 py-0.5 flex items-center justify-between">
				<div class="gap-1.5 min-w-0 flex items-center">
					<FileIcon size={12} class="shrink-0 text-muted-foreground" />
					<span class="text-xs truncate text-foreground"
						>{node.file.fileName}{node.file.fileType}</span
					>
				</div>
				<span class="text-xs shrink-0 text-muted-foreground"
					>{formatFileSize(getBase64FileSize(node.file.data))}</span
				>
			</div>
		{/if}
	{/each}
{/snippet}

{#snippet fileDisplay()}
	{#if fileCount === 0}
		<div class="rounded px-3 py-3 text-sm border border-border bg-muted text-muted-foreground">
			Waiting for file data...
		</div>
	{:else}
		<div class="gap-2 flex flex-col">
			<div class="rounded px-3 py-2 border border-border bg-muted">
				<div class="gap-2 flex items-center justify-between">
					<span class="min-w-0 text-sm font-medium truncate text-foreground">
						{fileCount === 1
							? `${filesArray[0].fileName}${filesArray[0].fileType}`
							: `${fileCount} files`}
					</span>
					<span class="text-xs shrink-0 text-muted-foreground">{formatFileSize(totalSize)}</span>
				</div>
				{#if fileCount > 1}
					<div class="mt-2">
						{#if fileTree}
							{@render treeNodes(fileTree, '')}
						{:else}
							<div class="gap-1 flex flex-col">
								{#each filesArray as file (file.fileName)}
									<div
										class="gap-2 text-xs flex items-center justify-between text-muted-foreground"
									>
										<span class="min-w-0 truncate">{file.fileName}{file.fileType}</span>
										<span class="shrink-0">{formatFileSize(getBase64FileSize(file.data))}</span>
									</div>
								{/each}
							</div>
						{/if}
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
	{#if item.widgetType !== 'chart' && item.widgetType !== 'image'}
		{@render fieldHeader()}
	{/if}

	{#if item.widgetType === 'chart'}
		<ChartOutput
			{item}
			value={typeof value === 'string' ? value : value != null ? JSON.stringify(value) : ''}
		/>
	{:else if item.widgetType === 'image'}
		<ImageOutput {item} {value} />
	{:else if item.widgetType === 'file'}
		{@render fileDisplay()}
	{:else if item.widgetType === 'number'}
		<div class="{boxClass} flex items-center bg-muted/50 wrap-break-word">
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
