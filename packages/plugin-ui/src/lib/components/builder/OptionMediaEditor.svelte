<script lang="ts">
	import type { DropdownWidgetConfig, OptionMedia } from '@selvajs/schemas';
	import { Button, Popover, pickFile, toast } from '@selvajs/ui';
	import { ImagePlus, Smile, X } from '@lucide/svelte';
	import { getBuilderDraft } from './draft-context';
	import LucideIconPicker from './LucideIconPicker.svelte';
	import { assetBytes } from '$lib/features/builder/option-media';
	import {
		blobToDataUri,
		drawThumbnail,
		encodeThumbnail,
		MAX_THUMBNAIL_BYTES,
		THUMBNAIL_PX
	} from '$lib/features/builder/image-encode';

	interface Props {
		config: DropdownWidgetConfig;
		/** Whether this mode shows thumbnails; only 'tiles' does. */
		showsImages: boolean;
	}

	let { config, showsImages }: Props = $props();

	const draft = getBuilderDraft();

	// Every byte here is saved into the .gh and each of its history backups.
	const WARN_TOTAL_BYTES = 256 * 1024;

	const names = $derived(Object.keys(config.options ?? {}));
	const totalBytes = $derived(assetBytes(draft?.assets));

	function setMedia(name: string, patch: Partial<OptionMedia>) {
		const next: OptionMedia = { ...config.optionMedia?.[name], ...patch };
		for (const key of Object.keys(next) as (keyof OptionMedia)[]) {
			if (next[key] === undefined) delete next[key];
		}
		const media = { ...config.optionMedia };
		if (Object.keys(next).length === 0) delete media[name];
		else media[name] = next;
		config.optionMedia = Object.keys(media).length > 0 ? media : undefined;
	}

	function pickIcon(name: string, icon: { name: string; path: string }) {
		draft?.edit(() => {
			const id = draft.putAsset({ d: icon.path });
			setMedia(name, { icon: id, iconName: `lucide:${icon.name}` });
		});
	}

	async function addImage(name: string) {
		const file = await pickFile({
			accept: 'image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp'
		});
		if (!file || !draft) return;
		try {
			const { encode, opaque } = await drawThumbnail(file);
			const result = await encodeThumbnail(encode, { opaque });
			if (!result.ok) {
				toast.error(
					`That image is still ${Math.round(result.smallestBytes / 1024)} KB at ${THUMBNAIL_PX} px; ` +
						`thumbnails must stay under ${MAX_THUMBNAIL_BYTES / 1024} KB. Try a simpler image.`
				);
				return;
			}
			const img = await blobToDataUri(result.blob);
			draft.edit(() => {
				const id = draft.putAsset({ img, w: THUMBNAIL_PX, h: THUMBNAIL_PX });
				setMedia(name, { image: id });
			});
		} catch {
			toast.error(`${file.name} could not be read as an image.`);
		}
	}

	function iconPath(name: string): string | undefined {
		const id = config.optionMedia?.[name]?.icon;
		return id ? draft?.assets?.[id]?.d : undefined;
	}

	function imageSrc(name: string): string | undefined {
		const id = config.optionMedia?.[name]?.image;
		return id ? draft?.assets?.[id]?.img : undefined;
	}
</script>

{#if draft}
	<div class="flex flex-col gap-1">
		<span class="text-muted-foreground text-2xs font-medium">Option icons</span>
		<ul class="border-border/70 divide-border/60 divide-y rounded-sm border">
			{#each names as name (name)}
				{@const path = iconPath(name)}
				{@const src = showsImages ? imageSrc(name) : undefined}
				<li class="flex items-center gap-1.5 px-1.5 py-1 text-xs">
					<Popover.Root>
						<Popover.Trigger>
							{#snippet child({ props })}
								<Button
									{...props}
									variant="outline"
									size="icon-sm"
									aria-label={`Icon for ${name}`}
									title="Pick an icon"
								>
									{#if path}
										<svg
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											stroke-width="2"
											stroke-linecap="round"
											stroke-linejoin="round"
											class="size-4"
											aria-hidden="true"><path d={path} /></svg
										>
									{:else}
										<Smile class="text-muted-foreground/60" />
									{/if}
								</Button>
							{/snippet}
						</Popover.Trigger>
						<Popover.Content align="start">
							<LucideIconPicker
								current={config.optionMedia?.[name]?.iconName}
								onPick={(icon) => pickIcon(name, icon)}
							/>
						</Popover.Content>
					</Popover.Root>

					{#if showsImages}
						<Button
							variant="outline"
							size="icon-sm"
							aria-label={`Image for ${name}`}
							title="Add a thumbnail"
							onclick={() => addImage(name)}
						>
							{#if src}
								<img {src} alt="" class="size-full rounded-sm object-cover" />
							{:else}
								<ImagePlus class="text-muted-foreground/60" />
							{/if}
						</Button>
					{/if}

					<span class="min-w-0 flex-1 truncate">{name}</span>

					{#if config.optionMedia?.[name]}
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label={`Remove icon and image from ${name}`}
							title="Remove"
							onclick={() =>
								draft.edit(() =>
									setMedia(name, { icon: undefined, iconName: undefined, image: undefined })
								)}
						>
							<X />
						</Button>
					{/if}
				</li>
			{/each}
		</ul>
		<span
			class={`text-2xs ${totalBytes > WARN_TOTAL_BYTES ? 'text-destructive' : 'text-muted-foreground/70'}`}
		>
			{totalBytes > WARN_TOTAL_BYTES
				? `Icons and images add ${Math.round(totalBytes / 1024)} KB to the .gh. Remove some to keep it quick to open.`
				: `Saved inside the .gh (${Math.round(totalBytes / 1024)} KB so far). Unused ones are dropped on save.`}
		</span>
	</div>
{/if}
