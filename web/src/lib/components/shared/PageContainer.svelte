<script lang="ts">
  import type { Snippet } from "svelte";

  interface PageContainerProps {
    background?: "default" | "white" | "gray";
    class?: string;
    children: Snippet;
  }

  let {
    background = "default",
    class: className = "",
    children,
  }: PageContainerProps = $props();

  const backgroundClasses = {
    default: "bg-gray-50",
    white: "bg-white",
    gray: "bg-gray-100",
  };

  const combinedClasses = $derived(
    `flex flex-col h-screen ${backgroundClasses[background]} ${className} `
  );
</script>

<div class={combinedClasses}>
  {@render children()}
</div>
