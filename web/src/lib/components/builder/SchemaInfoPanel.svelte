<script lang="ts">
  import type { UISchema } from "$lib/types/schema";
  import Panel from "../layout/Panel.svelte";
  import FormField from "../ui/FormField.svelte";
  import Input from "../ui/Input.svelte";
  import Textarea from "../ui/Textarea.svelte";

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
      <input
        type="checkbox"
        bind:checked={schema.enable3dViewer}
        class="w-4 h-4"
      />
      <span>Enable 3D Viewer Output</span>
    </label>
  </FormField>
</Panel>
