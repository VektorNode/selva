<script lang="ts">
	import { Button, Callout, Dialog, Input, InputGroup, Label, Spinner } from '@selvajs/ui';
	import { AppWindow, Eye, EyeOff, ImagePlus, X } from '@lucide/svelte';
	import type { AppExport } from '#lib/composables/useAppExport.svelte.js';
	import { APP_NAME_MAX } from '#lib/composables/app-export-core.js';

	interface Props {
		appExport: AppExport;
	}

	let { appExport }: Props = $props();

	const exportState = $derived(appExport.state);
	const blocker = $derived(appExport.blocker);

	function submit(event: SubmitEvent) {
		event.preventDefault();
		void appExport.exportApp();
	}
</script>

<Dialog.Root
	open={exportState.open}
	onOpenChange={(open) => {
		if (!open) appExport.close();
	}}
>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Export as app</Dialog.Title>
			<Dialog.Description>
				Saves this definition as one file that opens in the Selva app, with this UI and without
				Grasshopper on screen.
			</Dialog.Description>
		</Dialog.Header>

		<form class="flex flex-col gap-4" onsubmit={submit}>
			<div class="flex flex-col gap-1.5">
				<Label for="app-export-name">App name</Label>
				<Input
					id="app-export-name"
					bind:value={exportState.name}
					maxlength={APP_NAME_MAX}
					autocomplete="off"
					disabled={exportState.exporting}
				/>
			</div>

			<div class="flex flex-col gap-1.5">
				<Label for="app-export-icon">
					Icon <span class="text-muted-foreground font-normal">(optional)</span>
				</Label>
				<div class="flex items-center gap-2">
					<div
						class="bg-muted border-input text-faint-foreground flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md border [&_svg]:size-4"
					>
						{#if exportState.icon}
							<img
								src="data:image/png;base64,{exportState.icon}"
								alt=""
								class="size-full object-contain"
							/>
						{:else}
							<AppWindow />
						{/if}
					</div>
					<Button
						id="app-export-icon"
						variant="outline"
						disabled={exportState.exporting}
						onclick={appExport.pickIcon}
					>
						<ImagePlus />{exportState.icon ? 'Change image…' : 'Choose image…'}
					</Button>
					{#if exportState.icon}
						<Button
							variant="ghost"
							size="icon"
							aria-label="Remove icon"
							title="Remove icon"
							disabled={exportState.exporting}
							onclick={() => (exportState.icon = null)}
						>
							<X />
						</Button>
					{/if}
				</div>
				<p class="text-muted-foreground text-xs">
					Shown on the app's window and in the taskbar. Without one the app uses Selva's.
				</p>
			</div>

			<div class="flex flex-col gap-1.5">
				<Label for="app-export-key">
					Key <span class="text-muted-foreground font-normal">(optional)</span>
				</Label>
				<InputGroup.Root>
					<InputGroup.Input
						id="app-export-key"
						type={exportState.keyShown ? 'text' : 'password'}
						bind:value={exportState.key}
						placeholder="No key"
						autocomplete="new-password"
						disabled={exportState.exporting}
					/>
					<InputGroup.Addon align="inline-end">
						<InputGroup.Button
							size="icon-xs"
							aria-label={exportState.keyShown ? 'Hide key' : 'Show key'}
							title={exportState.keyShown ? 'Hide key' : 'Show key'}
							aria-pressed={exportState.keyShown}
							onclick={() => (exportState.keyShown = !exportState.keyShown)}
						>
							{#if exportState.keyShown}<EyeOff />{:else}<Eye />{/if}
						</InputGroup.Button>
					</InputGroup.Addon>
				</InputGroup.Root>
				<p class="text-muted-foreground text-xs">
					With a key, people need it once per computer to open the app. If you lose the key, export
					again.
				</p>
			</div>

			{#if exportState.error}
				<Callout tone="danger">{exportState.error}</Callout>
			{/if}

			<Dialog.Footer class="items-center">
				{#if blocker && !exportState.exporting}
					<p class="text-muted-foreground text-xs sm:mr-auto">{blocker}</p>
				{/if}
				<Button variant="outline" onclick={appExport.close}>Cancel</Button>
				<Button type="submit" disabled={!!blocker}>
					{#if exportState.exporting}
						<Spinner />Exporting…
					{:else}
						<AppWindow />Export
					{/if}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
