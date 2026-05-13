<script lang="ts">
	import { FolderOpen } from '@lucide/svelte';
	import { FilterableDropdown, type FilterableDropdownItem } from '@selvajs/ui';

	interface Project {
		id: string;
		name: string;
	}

	interface Props {
		projects: Project[];
		value: string;
		onChange: (id: string) => void;
		id?: string;
		placeholder?: string;
	}

	let { projects, value, onChange, id, placeholder = 'Select a project' }: Props = $props();

	const items = $derived<FilterableDropdownItem[]>(
		projects.map((p) => ({ id: p.id, label: p.name }))
	);
</script>

<FilterableDropdown
	{items}
	{value}
	{onChange}
	{id}
	{placeholder}
	triggerIcon={FolderOpen}
	searchPlaceholder="Filter projects"
/>
