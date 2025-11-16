<script lang="ts">
	interface Tab {
		id: string;
		label: string;
		icon?: string;
	}

	interface TabNavProps {
		tabs: Tab[];
		activeTabId: string;
		onTabChange: (tabId: string) => void;
		editable?: boolean;
		onRemove?: (tabId: string) => void;
		class?: string;
	}

	let { tabs, activeTabId, onTabChange, editable = false, onRemove, class: className = '' }: TabNavProps = $props();
</script>

<div class={`flex gap-1 border-b-2 border-gray-200 bg-gray-50 overflow-x-auto ${className}`}>
	{#each tabs as tab}
		<button
			class={`
				flex items-center gap-2 px-4 py-3 border-b-3 transition-all whitespace-nowrap font-medium
				${activeTabId === tab.id ? 'border-blue-600 text-blue-600 bg-white' : 'border-transparent text-gray-600 hover:text-gray-900 hover:bg-gray-100'}
			`}
			onclick={() => onTabChange(tab.id)}
		>
			{#if tab.icon}
				<span class="text-lg">{tab.icon}</span>
			{/if}
			{tab.label}

			{#if editable && onRemove && tabs.length > 1}
				<button
					class="ml-2 text-gray-400 hover:text-red-600 transition-colors"
					onclick={(e) => {
						e.stopPropagation();
						onRemove?.(tab.id);
					}}
				>
					×
				</button>
			{/if}
		</button>
	{/each}
</div>
