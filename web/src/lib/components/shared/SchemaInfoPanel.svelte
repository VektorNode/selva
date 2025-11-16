<script lang="ts">
	import Panel from './Panel.svelte';
	import FormField from './FormField.svelte';
	import Input from './Input.svelte';
	import Textarea from './Textarea.svelte';
	import type { UISchema } from '$lib/types/schema';

	interface SchemaInfoPanelProps {
		schema: UISchema;
	}

	let { schema }: SchemaInfoPanelProps = $props();
</script>

<Panel title="Schema Information">
	<FormField label="Name">
		<Input bind:value={schema.name} />
	</FormField>
	<FormField label="Description">
		<Textarea bind:value={schema.description} />
	</FormField>
	<FormField label="">
		<label class="flex items-center gap-2 cursor-pointer">
			<input type="checkbox" bind:checked={schema.enable3dViewer} class="w-4 h-4" />
			<span>Enable 3D Viewer Output</span>
		</label>
	</FormField>
</Panel>
