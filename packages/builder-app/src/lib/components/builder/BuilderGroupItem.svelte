<script lang="ts">
	import { dragStore } from '$lib/stores/dragStore.svelte';
	import type {
		LayoutItem,
		DiscoveredInput,
		NumberWidgetConfig,
		FileInputWidgetConfig
	} from '@selva/shared';
	import { Badge, Button, Card, Switch } from '@selva/shared';
	import { ArrowDownToLine, ArrowUpFromLine, ChevronDown } from '@lucide/svelte';
	import { ACCEPTED_FILE_FORMATS } from '$lib/features/builder/widget-config';

	interface BuilderGroupItemProps {
		item: LayoutItem;
		paramInfo?: DiscoveredInput;
		tabId: string;
		groupId: string;
		onRemove: () => void;
	}

	let { item, paramInfo, tabId, groupId, onRemove }: BuilderGroupItemProps = $props();

	let isNumberInput = $derived(item.type === 'input' && item.widgetType === 'number');
	let isFileInput = $derived(item.type === 'input' && item.widgetType === 'file');
	let showAdvanced = $state(false);
	let hasAdvancedOptions = $derived(isNumberInput || isFileInput);

	let isDragging = $state(false);
	let isDragOver = $state(false);
	let dropPosition: 'before' | 'after' | null = $state(null);
	let canDrag = $state(true);

	function toggleSliderMode() {
		if (!isNumberInput) return;
		const config = item.config as NumberWidgetConfig;
		config.renderAsSlider = !config.renderAsSlider;
	}

	function setFileInputMode(mode: 'upload' | 'url') {
		if (!isFileInput) return;
		const config = item.config as FileInputWidgetConfig;
		if (!config) return;
		config.defaultInputMode = mode;
	}

	function toggleAcceptedFormat(format: string) {
		if (!isFileInput) return;
		const config = item.config as FileInputWidgetConfig;
		if (!config) return;
		if (!config.acceptedFormats) {
			config.acceptedFormats = Array.from(ACCEPTED_FILE_FORMATS);
		}

		const index = config.acceptedFormats.indexOf(format);
		if (index > -1) {
			config.acceptedFormats.splice(index, 1);
		} else {
			config.acceptedFormats.push(format);
		}

		// Ensure at least one format is selected
		if (config.acceptedFormats.length === 0) {
			config.acceptedFormats = [format];
		}
	}

	function handleDragStart(e: DragEvent) {
		if (!canDrag) return e.preventDefault();
		isDragging = true;

		dragStore.set({
			dropType: 'group-item',
			data: { item, tabId, groupId }
		});

		e.dataTransfer?.setData('text/plain', item.id);
		e.dataTransfer!.effectAllowed = 'move';
	}

	function handleDragEnd() {
		isDragging = false;
		dragStore.clear();
	}

	function handleDragOver(e: DragEvent) {
		const dragData = dragStore.current;

		// Only show indicators for item/input/output drags (not group drags)
		// Group drags don't set dragStore, so this naturally filters them out
		if (!dragData || !['group-item', 'input', 'output'].includes(dragData.dropType)) return;

		e.preventDefault();
		e.stopPropagation();
		isDragOver = true;

		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const midpoint = rect.top + rect.height / 2;
		dropPosition = e.clientY < midpoint ? 'before' : 'after';

		e.dataTransfer!.dropEffect = dragData.dropType === 'group-item' ? 'move' : 'copy';
	}

	function handleDragLeave(e: DragEvent) {
		// Only clear if leaving the card itself, not child elements
		const relatedTarget = e.relatedTarget as Node | null;
		const currentTarget = e.currentTarget as Node;
		if (!relatedTarget || !currentTarget.contains(relatedTarget)) {
			isDragOver = false;
			dropPosition = null;
		}
	}

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		e.stopPropagation();
		isDragOver = false;

		const dragData = dragStore.current;
		if (!dragData) return;

		const detail =
			dragData.dropType === 'group-item'
				? {
						sourceItem: dragData.data.item,
						sourceTabId: dragData.data.tabId,
						sourceGroupId: dragData.data.groupId,
						targetItem: item,
						targetTabId: tabId,
						targetGroupId: groupId,
						dropPosition: dropPosition || 'after'
					}
				: {
						dropType: dragData.dropType,
						data: dragData.data,
						targetItem: item,
						targetTabId: tabId,
						targetGroupId: groupId,
						dropPosition: dropPosition || 'after'
					};

		const event = new CustomEvent(
			dragData.dropType === 'group-item' ? 'reorder' : 'parameterdrop',
			{
				detail,
				bubbles: true,
				composed: true
			}
		);

		(e.currentTarget as HTMLElement).dispatchEvent(event);
		dropPosition = null;
	}
</script>

<div class="relative">
	{#if isDragOver && dropPosition === 'before'}
		<div class="bg-primary absolute -top-0.5 right-0 left-0 h-0.5 rounded"></div>
	{/if}

	{#if isDragOver && dropPosition === 'after'}
		<div class="bg-primary absolute right-0 -bottom-0.5 left-0 h-0.5 rounded"></div>
	{/if}

	<Card.Root
		class={`
			hover:border-primary cursor-grab py-1
			transition-all hover:shadow-sm
			${isDragging ? 'cursor-grabbing opacity-50' : ''}
			${isDragOver ? 'border-primary' : ''}
			${item.type === 'input' ? 'bg-inputparam' : 'bg-outputparam'}
		`}
		draggable="true"
		ondragstart={handleDragStart}
		ondragend={handleDragEnd}
		ondragover={handleDragOver}
		ondragleave={handleDragLeave}
		ondrop={handleDrop}
	>
		<div class="grid grid-cols-[20px_1fr] gap-3 p-2">
			<div class="flex items-start pt-0.5">
				{#if item.type === 'input'}
					<ArrowUpFromLine size={14} class="text-muted-foreground" />
				{:else}
					<ArrowDownToLine size={14} class="text-muted-foreground" />
				{/if}
			</div>

			<div class="flex flex-col gap-2">
				<!-- Display Name + Remove -->
				<div class="flex items-center gap-2">
					<input
						type="text"
						bind:value={item.displayName}
						class="hover:border-border focus:border-primary flex-1 rounded-sm border border-transparent bg-transparent px-1 py-0.5
							   text-xs font-medium focus:outline-none"
						placeholder="Display Name"
						onmousedown={() => (canDrag = false)}
						onmouseup={() => (canDrag = true)}
						onmouseleave={() => (canDrag = true)}
					/>
					<Button
						variant="ghost"
						size="icon-sm"
						class="hover:bg-destructive hover:text-destructive-foreground h-4 w-4"
						onclick={onRemove}>×</Button
					>
				</div>

				<!-- Description -->
				<input
					type="text"
					bind:value={item.description}
					class="text-muted-foreground hover:border-border focus:border-primary rounded-sm border border-transparent bg-transparent px-1
						   py-0.5 text-[11px] focus:outline-none"
					placeholder="Description"
					onmousedown={() => (canDrag = false)}
					onmouseup={() => (canDrag = true)}
					onmouseleave={() => (canDrag = true)}
				/>

				<!-- Parameter Info / Type Badge -->
				{#if paramInfo}
					<div class="flex items-center gap-2">
						<Badge variant="default" class="rounded-xs px-1 py-0 text-[9px]">
							{paramInfo.type}
						</Badge>
						<span class="text-muted-foreground font-mono text-[9px]">
							GH: {paramInfo.nickname}
						</span>
					</div>
				{:else if item.type === 'output'}
					<div class="flex items-center gap-2">
						<Badge variant="default" class="rounded-xs px-1 py-0 text-[9px]">
							{item.widgetType}
						</Badge>
					</div>
				{/if}

				<!-- Advanced -->
				{#if hasAdvancedOptions}
					<div class="border-border/70 mt-1 border-t pt-1">
						<button
							onclick={() => (showAdvanced = !showAdvanced)}
							class="text-muted-foreground hover:text-foreground mb-2 flex w-full items-center gap-1 text-[11px]"
						>
							<ChevronDown
								size={12}
								class={`transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
							/>
							Advanced
						</button>

						{#if showAdvanced && isNumberInput}
							{@const config = item.config as NumberWidgetConfig}
							<div class="mt-1 flex items-center justify-between text-[11px]">
								<span class="text-muted-foreground">Slider</span>
								<Switch
									checked={config.renderAsSlider ?? true}
									onCheckedChange={toggleSliderMode}
									class="scale-75"
								/>
							</div>
						{/if}

						{#if showAdvanced && isFileInput}
							{@const config = item.config as FileInputWidgetConfig}
							<div class="flex flex-col gap-2">
								<!-- Input Type -->
								<div class="flex flex-col gap-1">
									<span class="text-muted-foreground text-[10px] font-medium">Input Type</span>
									<div class="grid grid-cols-2 gap-1">
										<button
											onclick={() => setFileInputMode('upload')}
											class={`rounded border px-2 py-1 text-[10px] transition-colors ${
												config?.defaultInputMode === 'upload'
													? 'bg-primary text-primary-foreground border-primary'
													: 'border-border/70 hover:border-border hover:bg-accent'
											}`}
										>
											Upload
										</button>
										<button
											onclick={() => setFileInputMode('url')}
											class={`rounded border px-2 py-1 text-[10px] transition-colors ${
												config?.defaultInputMode === 'url'
													? 'bg-primary text-primary-foreground border-primary'
													: 'border-border/70 hover:border-border hover:bg-accent'
											}`}
										>
											URL
										</button>
									</div>
								</div>

								<!-- File Formats -->
								<div class="flex flex-col gap-1">
									<span class="text-muted-foreground text-[10px] font-medium">File Formats</span>
									<div class="grid max-h-24 grid-cols-3 gap-1 overflow-y-auto">
										{#each ACCEPTED_FILE_FORMATS as format}
											{@const isChecked = config?.acceptedFormats?.includes(format)}
											<button
												onclick={() => toggleAcceptedFormat(format)}
												class={`rounded border px-1.5 py-0.5 text-[9px] whitespace-nowrap transition-colors ${
													isChecked
														? 'bg-primary text-primary-foreground border-primary'
														: 'border-border/70 hover:border-border hover:bg-accent'
												}`}
											>
												{format}
											</button>
										{/each}
									</div>
								</div>
							</div>
						{/if}
					</div>
				{/if}
			</div>
		</div>
	</Card.Root>
</div>
