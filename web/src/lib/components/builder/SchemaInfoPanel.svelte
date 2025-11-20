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
				<p class="text-xs text-muted-foreground">
			When enabled, a 3D viewer will be added to the UI to visualize geometry outputs.
		</p>
		<div class="flex items-center gap-2">
			<Checkbox
				id="instance-solve"
				checked={schema.instanceSolve ?? true}
				onCheckedChange={(checked) => (schema.instanceSolve = !!checked)}
			/>
			<Label for="instance-solve" class="cursor-pointer">Instant Solve</Label>
		</div>
		<p class="text-xs text-muted-foreground">
			When disabled, users must press a "Calculate" button to trigger solving instead of automatic
			updates.
		</p>
	</div>
</Panel>
