<script lang="ts">
	import Button from './Button.svelte';
	import Badge from './Badge.svelte';
	import type { GroupItem, AvailableParameter } from '$lib/types/schema';

	interface BuilderGroupItemProps {
		item: GroupItem;
		paramInfo?: AvailableParameter;
		onMoveUp: () => void;
		onMoveDown: () => void;
		onRemove: () => void;
	}

	let { item, paramInfo, onMoveUp, onMoveDown, onRemove }: BuilderGroupItemProps = $props();
</script>

<div
	class="bg-white border border-gray-300 rounded-md p-3 transition-all hover:border-blue-600 hover:shadow-md"
>
	<div class="flex items-center gap-2 mb-2">
		<span class="text-base">
			{item.type === 'input' ? '📥' : '📤'}
		</span>
		<input
			type="text"
			bind:value={item.displayName}
			class="flex-1 font-medium border border-transparent px-2 py-1 rounded-sm text-sm hover:border-gray-300 focus:border-blue-600 focus:outline-none"
			placeholder={paramInfo?.name || ''}
		/>
	</div>
	{#if paramInfo}
		<div class="flex gap-2 mb-2 text-xs">
			<Badge variant="info" size="small">
				{paramInfo.paramType}
			</Badge>
			<span class="text-gray-500 font-mono">
				{paramInfo.nickname}
			</span>
		</div>
	{/if}
	<div class="flex gap-1 justify-end">
		<Button variant="ghost" size="mini" onclick={onMoveUp}>↑</Button>
		<Button variant="ghost" size="mini" onclick={onMoveDown}>↓</Button>
		<Button
			variant="ghost"
			size="mini"
			class="hover:bg-red-600 hover:text-white"
			onclick={onRemove}
		>
			×
		</Button>
	</div>
</div>
