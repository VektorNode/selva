<script lang="ts">
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import { PageContainer } from "$lib/components/layout";
  import { StateDisplay } from "$lib/components/ui";
  import * as Card from "$lib/components/ui/card";
  import IconBuild from "$lib/components/ui/icons/IconBuild.svelte";
  import IconBold from "$lib/components/ui/icons/IconBold.svelte";

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
        <button onclick={() => navigateTo("builder")} class="text-left">
          <Card.Root class="h-full p-8 border-2 hover:border-primary hover:shadow-lg transition-all transform hover:-translate-y-1">
            <Card.Header class="p-0 mb-3">
              <Card.Title class="text-2xl flex items-center gap-2">
                <IconBuild></IconBuild>Schema Builder
              </Card.Title>
            </Card.Header>
            <Card.Content class="p-0">
              <p class="text-muted-foreground leading-relaxed">
                Configure your UI schema by selecting inputs and outputs from your
                Grasshopper definition
              </p>
            </Card.Content>
          </Card.Root>
        </button>

        <button onclick={() => navigateTo("preview")} class="text-left">
          <Card.Root class="h-full p-8 border-2 hover:border-primary hover:shadow-lg transition-all transform hover:-translate-y-1">
            <Card.Header class="p-0 mb-3">
              <Card.Title class="text-2xl flex items-center gap-2">
                <IconBold></IconBold> Interactive Preview
              </Card.Title>
            </Card.Header>
            <Card.Content class="p-0">
              <p class="text-muted-foreground leading-relaxed">
                Interact with your Grasshopper definition in real-time with live
                parameter updates
              </p>
            </Card.Content>
          </Card.Root>
        </button>
      </div>
    </div>
  {/if}
</PageContainer>
