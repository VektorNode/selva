<script lang="ts">
	import { Input } from '$lib/components/primitives/input';
	import { Button } from '$lib/components/primitives/button';
	import { Label } from '$lib/components/primitives/label';
	import { toast } from '$lib/components/primitives/sonner';
	import { FileUp, Link, CircleAlert, CircleCheck } from '@lucide/svelte';
	import { APP_DEFAULTS } from '$lib/constants';
	import { getLocaleContext } from '$lib/i18n/localeContext.svelte';
	import { formatMessage } from '$lib/i18n/messages';
	import { pickFile } from '$lib/utils/host-files';
	import { shouldConvertWebp, webpToPng } from '$lib/utils/webp-to-png';

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

	const locale = getLocaleContext();
	const t = $derived(locale.messages);

	let effectiveModes = $derived(
		allowedInputModes && allowedInputModes.length > 0
			? allowedInputModes
			: (['upload', 'url'] as const)
	);
	let showToggle = $derived(effectiveModes.length > 1);

	let activeMode = $state<'upload' | 'url'>('upload');
	$effect(() => {
		const preferred = defaultInputMode ?? 'upload';
		activeMode = effectiveModes.includes(preferred) ? preferred : effectiveModes[0];
	});

	let uploadedFileName = $state('');
	let urlInput = $state('');
	let isDragging = $state(false);
	let isLoading = $state(false);
	let urlError = $state<{ message: string; isCors: boolean; hint?: string } | null>(null);
	let urlSuccess = $state('');

	// The committed value is a JSON envelope; rebuild the display state from it.
	$effect(() => {
		if (value) {
			try {
				const parsed = typeof value === 'string' ? JSON.parse(value) : value;

				if (parsed.type === 'base64') {
					if (parsed._isMetadata && parsed._fileSize) {
						const sizeMB = (parsed._fileSize / 1024 / 1024).toFixed(2);
						uploadedFileName = formatMessage(t.uploadedFileSize, {
							ext: parsed.fileEnding,
							size: sizeMB
						});
					} else {
						uploadedFileName = formatMessage(t.uploadedFile, { ext: parsed.fileEnding });
					}
				} else if (parsed.type === 'url') {
					urlInput = parsed.file;
				}
			} catch {
				// Not JSON, ignore
			}
		}
	});

	function formatNotAccepted(fileEnding: string): string {
		return formatMessage(t.fileFormatNotAccepted, {
			ext: fileEnding,
			formats: acceptedFormats.join(', ')
		});
	}

	function formatTooLarge(bytes: number): string {
		return formatMessage(t.fileTooLarge, {
			size: (bytes / 1024 / 1024).toFixed(2),
			max: APP_DEFAULTS.FILE_UPLOAD.MAX_SIZE_MB
		});
	}

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

	// Runs before the size cap: the PNG is larger than the WebP it came from. A WebP already over
	// the cap is passed through unconverted, so the cap rejects it without a full decode.
	async function prepare(
		blob: Blob,
		fileEnding: string
	): Promise<{ blob: Blob; fileEnding: string }> {
		if (blob.size > APP_DEFAULTS.FILE_UPLOAD.MAX_SIZE_BYTES) return { blob, fileEnding };
		if (!shouldConvertWebp(fileEnding, acceptedFormats)) return { blob, fileEnding };
		return { blob: await webpToPng(blob), fileEnding: '.png' };
	}

	function readBase64(blob: Blob): Promise<string> {
		return new Promise<string>((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = (e) => {
				const result = e.target?.result as string;
				resolve(result.includes(',') ? result.split(',')[1] : result);
			};
			reader.onerror = () => reject(new Error(t.fileReadFailed));
			reader.readAsDataURL(blob);
		});
	}

	function isCorsError(error: unknown): boolean {
		// The browser blocks the response entirely, so this is all we get — no status code.
		if (error instanceof TypeError && error.message === 'Failed to fetch') return true;
		return false;
	}

	async function handleUrlChange() {
		if (!urlInput.trim()) return;

		isLoading = true;
		urlError = null;
		urlSuccess = '';
		uploadedFileName = '';

		try {
			let parsedUrl: URL;
			try {
				parsedUrl = new URL(urlInput);
			} catch {
				urlError = { message: t.urlInvalid, isCors: false };
				return;
			}

			if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
				urlError = { message: t.urlProtocolUnsupported, isCors: false };
				return;
			}

			const response = await fetch(urlInput);
			if (!response.ok) {
				urlError = {
					message: formatMessage(t.urlServerError, {
						status: `${response.status} ${response.statusText}`.trim()
					}),
					isCors: false
				};
				return;
			}

			const fetched = await response.blob();
			const requestedEnding = getFileExtension(urlInput);

			if (!isValidFileExtension(requestedEnding)) {
				urlError = { message: formatNotAccepted(requestedEnding), isCors: false };
				return;
			}

			const { blob, fileEnding } = await prepare(fetched, requestedEnding);

			const maxSize = APP_DEFAULTS.FILE_UPLOAD.MAX_SIZE_BYTES;
			if (blob.size > maxSize) {
				urlError = {
					message: `${formatTooLarge(blob.size)} ${t.fileTooLargeUseUpload}`,
					isCors: false
				};
				return;
			}

			const base64Data = await readBase64(blob);
			const data = JSON.stringify({ file: base64Data, type: 'base64', fileEnding });
			value = data;
			urlSuccess = formatMessage(t.fileLoaded, {
				ext: fileEnding,
				size: (blob.size / 1024).toFixed(0)
			});
			onChange(data);
		} catch (error) {
			if (isCorsError(error)) {
				const host = (() => {
					try {
						return new URL(urlInput).hostname;
					} catch {
						return '';
					}
				})();
				// The opaque TypeError hides CORS blocks and plain network failures (404, DNS)
				// alike, so the message has to cover both.
				let hint = t.urlUnreachableHint;
				if (host.includes('sharepoint.com') || host.includes('onedrive.com')) {
					hint = t.urlHintSharePoint;
				} else if (host.includes('drive.google.com')) {
					hint = t.urlHintGoogleDrive;
				} else if (host.includes('dropbox.com')) {
					hint = t.urlHintDropbox;
				}
				urlError = {
					message: formatMessage(t.urlUnreachable, { host }),
					isCors: true,
					hint
				};
			} else {
				urlError = {
					message: error instanceof Error ? error.message : t.unknownError,
					isCors: false
				};
			}
		} finally {
			isLoading = false;
		}
	}

	async function handleFile(file: File) {
		const requestedEnding = getFileExtension(file.name);

		if (!isValidFileExtension(requestedEnding)) {
			toast.error(formatNotAccepted(requestedEnding));
			return;
		}

		try {
			const { blob, fileEnding } = await prepare(file, requestedEnding);

			// The file is base64-embedded into the compute request body, so without a
			// client-side cap an oversize file comes back as an opaque 413. This cap is
			// currently LOOSER than the server's COMPUTE_REQUEST_MAX_BYTES (see the TEMP
			// note in constants.ts) — some files pass here and still 413. The URL import
			// path applies the same cap.
			if (blob.size > APP_DEFAULTS.FILE_UPLOAD.MAX_SIZE_BYTES) {
				toast.error(formatTooLarge(blob.size));
				return;
			}

			uploadedFileName = file.name;
			const data = JSON.stringify({ file: await readBase64(blob), type: 'base64', fileEnding });
			value = data;
			onChange(data);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : t.fileReadFailed);
		}
	}

	async function openFilePicker() {
		const file = await pickFile({ accept: acceptAttribute });
		if (file) handleFile(file);
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

		const file = e.dataTransfer?.files?.[0];
		if (file) handleFile(file);
	}

	const acceptAttribute = $derived(acceptedFormats.length > 0 ? acceptedFormats.join(',') : '*');
</script>

<div class="gap-2.5 flex w-full flex-col">
	{#if showToggle}
		<div class="p-0.5 text-xs flex rounded-md bg-muted">
			{#each effectiveModes as mode (mode)}
				<button
					type="button"
					onclick={() => (activeMode = mode)}
					aria-pressed={activeMode === mode}
					class={`px-3 py-1 font-medium flex-1 rounded-sm transition-colors ${
						activeMode === mode
							? 'shadow-xs bg-background text-foreground'
							: 'text-muted-foreground hover:text-foreground'
					}`}
				>
					{mode === 'upload' ? t.fileModeUpload : t.fileModeUrl}
				</button>
			{/each}
		</div>
	{/if}

	{#if activeMode === 'url'}
		<div class="gap-2 flex flex-col">
			<Label for="url-input">
				<Link size={16} />
				{t.fileUrlLabel}
			</Label>
			<div class="gap-2 flex">
				<Input
					id="url-input"
					type="url"
					bind:value={urlInput}
					placeholder="https://example.com/model.3dm"
					disabled={isLoading}
					aria-invalid={urlError ? true : undefined}
					oninput={() => {
						urlError = null;
						urlSuccess = '';
					}}
				/>
				<Button
					type="button"
					variant="outline"
					disabled={isLoading || !urlInput.trim()}
					onclick={handleUrlChange}
				>
					{isLoading ? t.fetchingFile : t.fetchFile}
				</Button>
			</div>

			{#if urlSuccess}
				<div class="gap-1.5 text-xs flex items-center text-success">
					<CircleCheck size={13} />
					{urlSuccess}
				</div>
			{/if}

			{#if urlError}
				<div
					class="p-2.5 gap-1.5 flex flex-col rounded-md border border-destructive/40 bg-destructive/5"
				>
					<div class="gap-1.5 flex items-start">
						<CircleAlert size={13} class="mt-0.5 shrink-0 text-destructive" />
						<p class="text-xs leading-snug text-destructive">{urlError.message}</p>
					</div>
					{#if urlError.isCors && urlError.hint}
						<p class="text-xs leading-snug pl-5 text-muted-foreground">{urlError.hint}</p>
					{/if}
				</div>
			{/if}

			{#if !urlError && !urlSuccess}
				<p class="text-xs text-muted-foreground">{t.fileUrlPublic}</p>
			{/if}
		</div>
	{:else}
		<div class="gap-2 flex flex-col">
			<Button
				type="button"
				variant={isDragging ? 'secondary' : 'outline'}
				class="w-full"
				onclick={openFilePicker}
				ondragover={handleDragOver}
				ondragleave={handleDragLeave}
				ondrop={handleDrop}
			>
				<FileUp size={16} />
				{uploadedFileName || t.chooseFile}
			</Button>
			{#if acceptedFormats.length > 0}
				<p class="text-xs text-muted-foreground">
					{formatMessage(t.acceptedFormats, { formats: acceptedFormats.join(', ') })}
				</p>
			{/if}
		</div>
	{/if}
</div>
