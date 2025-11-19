<script lang="ts">
  import type {
    UISchema,
    InputLayoutItem,
    OutputLayoutItem,
    InputParamSchema,
    OutputParamSchema,
  } from "$lib/types/schema";
  import Panel from "../layout/Panel.svelte";
  import StateDisplay from "../ui/StateDisplay.svelte";
  import InputControl from "./InputControl.svelte";
  import OutputDisplay from "./OutputDisplay.svelte";

  interface Props {
    schema: UISchema;
    values: Record<string, any>;
    onValueChange: (paramId: string, value: any) => void;
    debounceSliders?: boolean;
  }

  let {
    schema,
    values = $bindable(),
    onValueChange,
    debounceSliders = false,
  }: Props = $props();

  function createInputLayoutItem(input: InputParamSchema): InputLayoutItem {
    const baseItem = {
      id: `layout-${input.id}`,
      paramId: input.id,
      type: "input" as const,
      displayName: input.nickname || input.name,
      order: 0,
      span: 1,
    };

    if (input.paramType === "Number" || input.paramType === "Integer") {
      return {
        ...baseItem,
        widgetType: "number" as const,
        config: {
          min: (input.minimum as number) ?? 0,
          max: (input.maximum as number) ?? 100,
          step: input.stepSize ? Number(input.stepSize) : 1,
          renderAsSlider: true,
        },
      } as Extract<InputLayoutItem, { widgetType: "number" }>;
    } else if (input.paramType === "Boolean") {
      return {
        ...baseItem,
        widgetType: "checkbox" as const,
        config: {},
      } as Extract<InputLayoutItem, { widgetType: "checkbox" }>;
    } else {
      return {
        ...baseItem,
        widgetType: "text" as const,
        config: {
          placeholder: "",
          required: false,
        },
      } as Extract<InputLayoutItem, { widgetType: "text" }>;
    }
  }

  function createOutputLayoutItem(output: OutputParamSchema): OutputLayoutItem {
    const baseItem = {
      id: `layout-${output.id}`,
      paramId: output.id,
      type: "output" as const,
      displayName: output.nickname || output.name,
      order: 0,
      span: 1,
    };

    if (output.paramType === "Number" || output.paramType === "Integer") {
      return {
        ...baseItem,
        widgetType: "number" as const,
        config: {
          format: undefined,
          unit: undefined,
        },
      } as Extract<OutputLayoutItem, { widgetType: "number" }>;
    } else if (
      [
        "Point",
        "Vector",
        "Plane",
        "Line",
        "Circle",
        "Rectangle",
        "Box",
        "Curve",
        "Surface",
        "Brep",
        "Mesh",
        "SubD",
        "Geometry",
      ].includes(output.paramType)
    ) {
      return {
        ...baseItem,
        widgetType: "3d-viewer" as const,
        config: {},
      } as Extract<OutputLayoutItem, { widgetType: "3d-viewer" }>;
    } else {
      return {
        ...baseItem,
        widgetType: "text" as const,
        config: {
          format: undefined,
        },
      } as Extract<OutputLayoutItem, { widgetType: "text" }>;
    }
  }
</script>

<div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
  <Panel title="Inputs">
    {#if schema.inputs.length === 0}
      <StateDisplay type="empty" size="small" message="No inputs available" />
    {:else}
      <div class="grid gap-6">
        {#each schema.inputs as input}
          {@const layoutItem = createInputLayoutItem(input)}
          <div class="grid gap-2">
            <InputControl
              item={layoutItem}
              bind:value={values[input.id]}
              onChange={onValueChange}
              debounceMs={layoutItem.widgetType === "number" &&
              (layoutItem.config as any).renderAsSlider &&
              debounceSliders
                ? 20
                : 0}
            />
            <span class="text-sm text-muted-foreground font-mono">
              {values[input.id] ?? "—"}
            </span>
          </div>
        {/each}
      </div>
    {/if}
  </Panel>

  <!-- Outputs Panel -->
  <Panel title="Outputs">
    {#if schema.outputs.length === 0}
      <StateDisplay type="empty" size="small" message="No outputs available" />
    {:else}
      <div class="grid gap-6">
        {#each schema.outputs as output}
          {@const layoutItem = createOutputLayoutItem(output)}
          <OutputDisplay item={layoutItem} value={values[output.id]} />
        {/each}
      </div>
    {/if}
  </Panel>
</div>
