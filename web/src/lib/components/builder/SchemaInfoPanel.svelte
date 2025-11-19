<script lang="ts">
	import type { UISchema } from '$lib/types/generated';
	import Panel from '../layout/Panel.svelte';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Label } from '$lib/components/ui/label';
	import { Checkbox } from '$lib/components/ui/checkbox';

	interface SchemaInfoPanelProps {
		schema: UISchema;
	}

	let { schema }: SchemaInfoPanelProps = $props();
</script>

<Panel title="Schema Information">
	<div class="flex flex-col gap-4">
		<div class="flex flex-col gap-2">
			<Label for="schema-name">Name</Label>
			<Input id="schema-name" bind:value={schema.name} />
		</div>
		<div class="flex flex-col gap-2">
			<Label for="schema-description">Description</Label>
			<Textarea id="schema-description" bind:value={schema.description} />
		</div>
		<div class="flex items-center gap-2">
			<Checkbox
				id="enable-3d-viewer"
				checked={schema.enable3dViewer}
				onCheckedChange={(checked) => (schema.enable3dViewer = !!checked)}
			/>
			<Label for="enable-3d-viewer" class="cursor-pointer">Enable 3D Viewer Output</Label>
		</div>
	</div>
</Panel>
