<script lang="ts">
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import { PageContainer } from "$lib/components/layout";
  import { StateDisplay } from "$lib/components/ui";

  var sessionId = page.url.searchParams.get("session");

  function navigateTo(path: string) {
    goto(`/${path}?session=${sessionId}`);
  }
</script>

<PageContainer background="white">
  {#if !sessionId}
    <div class="flex items-center justify-center min-h-screen">
      <StateDisplay
        type="error"
        size="large"
        title="No Session ID"
        message="No session ID provided in URL. Please start from the Grasshopper component."
      />
    </div>
  {:else}
    <div class="p-12 max-w-4xl mx-auto w-full">
      <h2 class="text-4xl font-bold mb-4 text-foreground">
        Welcome to ComputeBuilder
      </h2>
      <p class="text-muted-foreground mb-8 text-lg">
        Choose a mode to get started:
      </p>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <button
          class="bg-card border-2 border-border rounded-lg p-8 text-left hover:border-primary hover:shadow-lg transition-all transform hover:-translate-y-1"
          onclick={() => navigateTo("builder")}
        >
          <h3 class="text-2xl font-semibold mb-3 text-foreground">
            🔧 Schema Builder
          </h3>
          <p class="text-muted-foreground leading-relaxed">
            Configure your UI schema by selecting inputs and outputs from your
            Grasshopper definition
          </p>
        </button>

        <button
          class="bg-card border-2 border-border rounded-lg p-8 text-left hover:border-primary hover:shadow-lg transition-all transform hover:-translate-y-1"
          onclick={() => navigateTo("preview")}
        >
          <h3 class="text-2xl font-semibold mb-3 text-foreground">
            ⚡ Interactive Preview
          </h3>
          <p class="text-muted-foreground leading-relaxed">
            Interact with your Grasshopper definition in real-time with live
            parameter updates
          </p>
        </button>
      </div>
    </div>
  {/if}
</PageContainer>
