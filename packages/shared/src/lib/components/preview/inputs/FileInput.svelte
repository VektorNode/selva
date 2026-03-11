<script lang="ts">
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import { FileUp, Link, CircleAlert, CircleCheck } from '@lucide/svelte';
	import { APP_CONSTANTS } from '$lib/constants';

	interface Props {
		value?: string;
		acceptedFormats?: string[];
		defaultInputMode?: 'upload' | 'url';
		allowedInputModes?: ('upload' | 'url')[];
		onChange: (value: string) => void;
	}

	let {
		value = $bindable(),
		acceptedFormats = [],
		defaultInputMode = 'upload',
		allowedInputModes,
		onChange
	}: Props = $props();

	// Resolve which modes are actually available
	let effectiveModes = $derived(
		allowedInputModes && allowedInputModes.length > 0 ? allowedInputModes : (['upload', 'url'] as const)
	);
	let showToggle = $derived(effectiveModes.length > 1);

	// Active mode: default to defaultInputMode if allowed, otherwise first allowed mode
	let activeMode = $state<'upload' | 'url'>('upload');
	$effect(() => {
		const preferred = defaultInputMode ?? 'upload';
		activeMode = effectiveModes.includes(preferred) ? preferred : effectiveModes[0];
	});

	let fileInput: HTMLInputElement | null = $state(null);
	let uploadedFileName = $state('');
	let urlInput = $state('');
	let isDragging = $state(false);
	let isLoading = $state(false);
	let urlError = $state<{ message: string; isCors: boolean } | null>(null);
	let urlSuccess = $state('');

	// Parse existing value if it's JSON
	$effect(() => {
		if (value) {
			try {
				const parsed = typeof value === 'string' ? JSON.parse(value) : value;

				if (parsed.type === 'base64') {
					if (parsed._isMetadata && parsed._fileSize) {
						const sizeMB = (parsed._fileSize / 1024 / 1024).toFixed(2);
						uploadedFileName = `Uploaded file (${parsed.fileEnding}, ${sizeMB}MB)`;
					} else {
						uploadedFileName = `Uploaded file (${parsed.fileEnding})`;
					}
				} else if (parsed.type === 'url') {
					urlInput = parsed.file;
				}
			} catch {
				// Not JSON, ignore
			}
		}
	});

	function getFileExtension(filename: string): string {
		// Strip query strings before extracting extension
		const cleanPath = filename.split('?')[0];
		const ext = cleanPath.includes('.') ? '.' + cleanPath.split('.').pop() : '.tmp';
		return ext.toLowerCase();
	}

	function isValidFileExtension(fileEnding: string): boolean {
		if (acceptedFormats.length === 0) return true;
		return acceptedFormats.includes(fileEnding.toLowerCase());
	}

	function isCorsError(error: unknown): boolean {
		// CORS errors surface as a generic TypeError with no useful status code
		// because the browser blocks the response entirely
		if (error instanceof TypeError && error.message === 'Failed to fetch') return true;
		return false;
	}

	async function handleUrlChange() {
		if (!urlInput.trim()) return;

		// Reset all state before starting a new fetch
		isLoading = true;
		urlError = null;
		urlSuccess = '';
		uploadedFileName = '';

		try {
			// Validate URL format first
			let parsedUrl: URL;
			try {
				parsedUrl = new URL(urlInput);
			} catch {
				urlError = { message: 'Invalid URL — make sure it starts with https://', isCors: false };
				isLoading = false;
				return;
			}

			if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
				urlError = { message: 'Only http:// and https:// URLs are supported.', isCors: false };
				isLoading = false;
				return;
			}

			const response = await fetch(urlInput);
			if (!response.ok) {
				urlError = {
					message: `Server returned ${response.status} ${response.statusText}. Check the URL is correct and publicly accessible.`,
					isCors: false
				};
				isLoading = false;
				return;
			}

			const blob = await response.blob();
			const fileEnding = getFileExtension(urlInput);

			if (!isValidFileExtension(fileEnding)) {
				urlError = {
					message: `File format "${fileEnding}" is not accepted. Allowed: ${acceptedFormats.join(', ')}`,
					isCors: false
				};
				isLoading = false;
				return;
			}

			const maxSize = APP_CONSTANTS.FILE_UPLOAD.MAX_SIZE_BYTES;
			if (blob.size > maxSize) {
				urlError = {
					message: `File too large: ${(blob.size / 1024 / 1024).toFixed(2)}MB (max ${APP_CONSTANTS.FILE_UPLOAD.MAX_SIZE_MB}MB). Download it and use Upload instead.`,
					isCors: false
				};
				isLoading = false;
				return;
			}

			// FileReader is async — keep isLoading=true until it completes
			await new Promise<void>((resolve, reject) => {
				const reader = new FileReader();
				reader.onload = (e) => {
					const base64 = e.target?.result as string;
					const base64Data = base64.includes(',') ? base64.split(',')[1] : base64;
					const data = JSON.stringify({ file: base64Data, type: 'base64', fileEnding });
					value = data;
					urlSuccess = `Loaded ${fileEnding} (${(blob.size / 1024).toFixed(0)} KB)`;
					onChange(data);
					resolve();
				};
				reader.onerror = () => reject(new Error('Failed to read the downloaded file.'));
				reader.readAsDataURL(blob);
			});
		} catch (error) {
			if (isCorsError(error)) {
				const host = (() => { try { return new URL(urlInput).hostname; } catch { return ''; } })();
				// We can't distinguish CORS blocks from non-CORS network errors (404, DNS fail, etc.)
				// because the browser hides all of them behind the same opaque TypeError.
				// Give a message that covers both cases.
				let hint = 'Check that the URL is correct and the file is publicly accessible. If the server requires login, download the file and use the Upload option instead.';
				if (host.includes('sharepoint.com') || host.includes('onedrive.com')) {
					hint = 'SharePoint/OneDrive blocks browser access. Open the file in SharePoint, use "Download" to save it locally, then upload it here.';
				} else if (host.includes('drive.google.com')) {
					hint = 'Google Drive blocks browser access. Use "Download" in Google Drive to save the file locally, then upload it here.';
				} else if (host.includes('dropbox.com')) {
					hint = 'Dropbox links may block browser access. Try changing "?dl=0" to "?dl=1" in the URL, or download and upload instead.';
				}
				urlError = {
					message: `Could not reach "${host}" — the file may not exist, or the server does not allow browser access.`,
					isCors: true,
					// @ts-ignore
					hint
				};
			} else {
				urlError = {
					message: error instanceof Error ? error.message : 'Unknown error',
					isCors: false
				};
			}
		} finally {
			isLoading = false;
		}
	}

	function handleFileUpload(event: Event) {
		const target = event.target as HTMLInputElement;
		const file = target.files?.[0];
		if (!file) return;

		const fileEnding = getFileExtension(file.name);

		if (!isValidFileExtension(fileEnding)) {
			alert(`File format not accepted: ${fileEnding}`);
			return;
		}

		uploadedFileName = file.name;

		const reader = new FileReader();
		reader.onload = (e) => {
			const base64 = e.target?.result as string;
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
			const fakeEvent = new Event('change');
			const fakeTarget = { files: files } as HTMLInputElement;
			Object.defineProperty(fakeEvent, 'target', { value: fakeTarget });
			handleFileUpload(fakeEvent);
		}
	}

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

	<!-- Mode toggle (only shown when both modes are allowed) -->
	{#if showToggle}
		<div class="flex rounded border overflow-hidden text-xs">
			{#each effectiveModes as mode (mode)}
				<button
					type="button"
					onclick={() => (activeMode = mode)}
					class={`flex-1 px-3 py-1 transition-colors ${
						activeMode === mode
							? 'bg-primary text-primary-foreground'
							: 'hover:bg-accent text-muted-foreground'
					}`}
				>
					{mode === 'upload' ? 'Upload' : 'URL'}
				</button>
			{/each}
		</div>
	{/if}

	{#if activeMode === 'url'}
		<!-- URL Input -->
		<div class="gap-2 flex flex-col">
			<Label for="url-input" class="gap-2 flex items-center">
				<Link size={16} />
				File URL
			</Label>
			<div class="gap-2 flex">
				<Input
					id="url-input"
					type="url"
					bind:value={urlInput}
					placeholder="https://example.com/model.3dm"
					disabled={isLoading}
					class={urlError ? 'border-destructive focus-visible:ring-destructive' : ''}
					oninput={() => { urlError = null; urlSuccess = ''; }}
				/>
				<Button
					type="button"
					variant="outline"
					disabled={isLoading || !urlInput.trim()}
					onclick={handleUrlChange}
				>
					{isLoading ? 'Fetching...' : 'Fetch'}
				</Button>
			</div>

			<!-- Success state -->
			{#if urlSuccess}
				<div class="flex items-center gap-1.5 text-xs text-success">
					<CircleCheck size={13} />
					{urlSuccess}
				</div>
			{/if}

			<!-- Error state -->
			{#if urlError}
				<div class="rounded-md border border-destructive/40 bg-destructive/5 p-2.5 flex flex-col gap-1.5">
					<div class="flex items-start gap-1.5">
						<CircleAlert size={13} class="text-destructive mt-0.5 shrink-0" />
						<p class="text-xs text-destructive leading-snug">{urlError.message}</p>
					</div>
					{#if urlError.isCors && (urlError as any).hint}
						<p class="text-xs text-muted-foreground leading-snug pl-5">{(urlError as any).hint}</p>
					{/if}
				</div>
			{/if}

			{#if !urlError && !urlSuccess}
				<p class="text-xs text-muted-foreground">
					URL must be publicly accessible (no login required).
				</p>
			{/if}
		</div>
	{:else}
		<!-- File Upload -->
		<div class="gap-2 flex flex-col">
			<Label for="file-upload" class="gap-2 flex items-center">
				<FileUp size={16} />
				Upload File
			</Label>
			<Button
				type="button"
				variant="outline"
				class="gap-2 w-full {isDragging ? 'border-primary' : ''}"
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
	{/if}
</div>
