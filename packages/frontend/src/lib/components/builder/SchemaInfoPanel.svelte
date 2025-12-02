<script lang="ts">
  import type { UISchema } from '$lib/types/generated';
  import * as Card from '$lib/components/ui/card';
  import { Input } from '$lib/components/ui/input';
  import { Textarea } from '$lib/components/ui/textarea';
  import { Label } from '$lib/components/ui/label';
  import { Checkbox } from '$lib/components/ui/checkbox';

  interface SchemaInfoPanelProps {
    schema: UISchema;
    onSchemaChange?: (schema: UISchema) => void;
  }

  let { schema, onSchemaChange }: SchemaInfoPanelProps = $props();

  function updateSchema(updates: Partial<UISchema>) {
    const updatedSchema = { ...schema, ...updates };
    onSchemaChange?.(updatedSchema);
  }
</script>

<Card.Root class="shadow-sm">
  <Card.Header>
    <Card.Title class="text-xl">Schema Information</Card.Title>
  </Card.Header>
  <Card.Content>
    <div class="flex flex-col gap-4">
      <div class="flex flex-col gap-2">
        <Label for="schema-name">Name</Label>
        <Input
          id="schema-name"
          value={schema.name}
          oninput={(e) => updateSchema({ name: e.currentTarget.value })}
        />
      </div>
      <div class="flex flex-col gap-2">
        <Label for="schema-description">Description</Label>
        <Textarea
          id="schema-description"
          value={schema.description}
          oninput={(e) => updateSchema({ description: e.currentTarget.value })}
        />
      </div>
      <div class="flex items-center gap-2">
        <Checkbox
          id="enable-3d-viewer"
          checked={schema.enable3dViewer}
          onCheckedChange={(checked) => updateSchema({ enable3dViewer: !!checked })}
        />
        <Label for="enable-3d-viewer" class="cursor-pointer">Enable 3D Viewer Output</Label>
      </div>
      <p class="text-xs text-muted-foreground">
        When enabled, a 3D viewer will be added to the UI to visualize geometry outputs.
      </p>
      <div class="flex items-center gap-2">
        <Checkbox
          id="enable-local-rendering"
          checked={schema.allowLocalRendering}
          onCheckedChange={(checked) => updateSchema({ allowLocalRendering: !!checked })}
        />
        <Label for="enable-3d-viewer" class="cursor-pointer">Enable Local Render</Label>
      </div>
      <p class="text-xs text-muted-foreground">
        When enabled, users can render geometry locally in their browser without needing a remote
        server.
      </p>
      <div class="flex items-center gap-2">
        <Checkbox
          id="instance-solve"
          checked={schema.instanceSolve ?? true}
          onCheckedChange={(checked) => updateSchema({ instanceSolve: !!checked })}
        />
        <Label for="instance-solve" class="cursor-pointer">Instant Solve</Label>
      </div>
      <p class="text-xs text-muted-foreground">
        When disabled, users must press a "Calculate" button to trigger solving instead of automatic
        updates.
      </p>
    </div>
  </Card.Content>
</Card.Root>
