<script lang="ts">
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import { FileUp, Link, FolderOpen } from '@lucide/svelte';

	interface Props {
		value?: string;
		acceptedFormats?: string[];
		onChange: (value: string) => void;
	}

	let {
		value = $bindable(),
		acceptedFormats = [],
		onChange
	}: Props = $props();

	let fileInput: HTMLInputElement | null = $state(null);
	let uploadedFileName = $state('');
	let pathInput = $state('');
	let urlInput = $state('');
	let isDragging = $state(false);

	// Parse existing value if it's JSON
	$effect(() => {
		if (value) {
			try {
				const parsed = JSON.parse(value);
				if (parsed.type === 'base64') {
					uploadedFileName = `Uploaded file (${parsed.fileEnding})`;
				} else if (parsed.type === 'path') {
					pathInput = parsed.file;
				} else if (parsed.type === 'url') {
					urlInput = parsed.file;
				}
			} catch {
				// Not JSON, ignore
			}
		}
	});

	function getFileExtension(filename: string): string {
		const ext = filename.includes('.') ? '.' + filename.split('.').pop() : '.tmp';
		return ext.toLowerCase();
	}

	function handlePathChange() {
		const fileEnding = getFileExtension(pathInput);
		const data = JSON.stringify({
			file: pathInput,
			type: 'path',
			fileEnding
		});
		value = data;
		onChange(data);
	}

	function handleUrlChange() {
		const fileEnding = getFileExtension(urlInput);
		const data = JSON.stringify({
			file: urlInput,
			type: 'url',
			fileEnding
		});
		value = data;
		onChange(data);
	}

	function handleFileUpload(event: Event) {
		const target = event.target as HTMLInputElement;
		const file = target.files?.[0];
		if (!file) return;

		uploadedFileName = file.name;
		const fileEnding = getFileExtension(file.name);

		// Convert to base64 for web usage
		const reader = new FileReader();
		reader.onload = (e) => {
			const base64 = e.target?.result as string;
			// Remove data URL prefix (e.g., "data:application/octet-stream;base64,")
			const base64Data = base64.includes(',') ? base64.split(',')[1] : base64;

			const data = JSON.stringify({
				file: base64Data,
				type: 'base64',
				fileEnding
			});
			value = data;
			onChange(data);
		};
		reader.readAsDataURL(file);
	}

	function openFilePicker() {
		fileInput?.click();
	}

	function handleDragOver(e: DragEvent) {
		e.preventDefault();
		isDragging = true;
	}

	function handleDragLeave() {
		isDragging = false;
	}

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		isDragging = false;

		const files = e.dataTransfer?.files;
		if (files?.[0]) {
			const file = files[0];
			// Create a fake event to reuse handleFileUpload logic
			const fakeEvent = new Event('change');
			const fakeTarget = { files: files } as HTMLInputElement;
			Object.defineProperty(fakeEvent, 'target', { value: fakeTarget });
			handleFileUpload(fakeEvent);
		}
	}

	// Generate accept attribute for file input
	const acceptAttribute = $derived(acceptedFormats.length > 0 ? acceptedFormats.join(',') : '*');
</script>

<div class="gap-4 flex w-full flex-col">
	<!-- Hidden file input -->
	<input
		bind:this={fileInput}
		type="file"
		accept={acceptAttribute}
		onchange={handleFileUpload}
		class="hidden"
	/>

	<!-- Path Input (for direct Rhino usage without web UI) -->
	<div class="gap-2 flex flex-col">
		<Label for="path-input" class="gap-2 flex items-center">
			<FolderOpen size={16} />
			File Path
		</Label>
		<Input
			id="path-input"
			type="text"
			bind:value={pathInput}
			placeholder="C:\path\to\file.3dm"
			oninput={handlePathChange}
		/>
		<p class="text-xs text-muted-foreground">
			Enter a file path (used when running directly in Rhino without web interface).
		</p>
	</div>

	<!-- URL Input -->
	<div class="gap-2 flex flex-col">
		<Label for="url-input" class="gap-2 flex items-center">
			<Link size={16} />
			File URL
		</Label>
		<Input
			id="url-input"
			type="url"
			bind:value={urlInput}
			placeholder="https://example.com/model.3dm"
			oninput={handleUrlChange}
		/>
		<p class="text-xs text-muted-foreground">Enter a URL to download the file from.</p>
	</div>

	<!-- File Upload (for web usage - always base64) -->
	<div class="gap-2 flex flex-col">
		<Label for="file-upload" class="gap-2 flex items-center">
			<FileUp size={16} />
			Upload File
		</Label>
		<Button
			type="button"
			variant="outline"
			class="gap-2 w-full {isDragging ? 'border-blue-500' : ''}"
			onclick={openFilePicker}
			ondragover={handleDragOver}
			ondragleave={handleDragLeave}
			ondrop={handleDrop}
		>
			<FileUp size={16} />
			{uploadedFileName || 'Choose File or Drag & Drop'}
		</Button>
		{#if acceptedFormats.length > 0}
			<p class="text-xs text-muted-foreground">
				Accepted formats: {acceptedFormats.join(', ')}
			</p>
		{/if}
	</div>
</div>

<style>
	:global(.border-blue-500) {
		border-color: rgb(59, 130, 246);
	}
</style>
