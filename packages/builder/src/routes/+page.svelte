<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { PageContainer } from '$lib/components/layout';
  import { StateDisplay } from '$lib/components/ui';
  import * as Card from '$lib/components/ui/card';
  import IconBuild from '$lib/components/ui/icons/IconBuild.svelte';
  import IconBold from '$lib/components/ui/icons/IconBold.svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';

  var sessionId = page.url.searchParams.get('session');

  function navigateTo(path: string) {
    goto(`/${path}?session=${sessionId}`);
  }
</script>

<PageContainer background="white">
  <PageHeader title="Selva" showModeToggle={true} />
  {#if !sessionId}
    <div class="flex min-h-screen items-center justify-center">
      <StateDisplay
        type="error"
        size="large"
        title="No Session ID"
        message="No session ID provided in URL. Please start from the Grasshopper component."
      />
    </div>
  {:else}
    <div class="mx-auto w-full max-w-4xl p-12">
      <h2 class="mb-4 text-4xl font-bold text-foreground">Welcome to Selva</h2>
      <p class="mb-8 text-lg text-muted-foreground">Choose a mode to get started:</p>

      <div class="grid grid-cols-1 gap-6 md:grid-cols-2">
        <button onclick={() => navigateTo('builder')} class="text-left">
          <Card.Root
            class="h-full transform border-2 p-8 transition-all hover:-translate-y-1 hover:border-primary hover:shadow-lg"
          >
            <Card.Header class="mb-3 p-0">
              <Card.Title class="flex items-center gap-2 text-2xl">
                <IconBuild></IconBuild>Schema Builder
              </Card.Title>
            </Card.Header>
            <Card.Content class="p-0">
              <p class="leading-relaxed text-muted-foreground">
                Configure your UI schema by selecting inputs and outputs from your Grasshopper
                definition
              </p>
            </Card.Content>
          </Card.Root>
        </button>

        <button onclick={() => navigateTo('preview')} class="text-left">
          <Card.Root
            class="h-full transform border-2 p-8 transition-all hover:-translate-y-1 hover:border-primary hover:shadow-lg"
          >
            <Card.Header class="mb-3 p-0">
              <Card.Title class="flex items-center gap-2 text-2xl">
                <IconBold></IconBold> Interactive Preview
              </Card.Title>
            </Card.Header>
            <Card.Content class="p-0">
              <p class="leading-relaxed text-muted-foreground">
                Interact with your Grasshopper definition in real-time with live parameter updates
              </p>
            </Card.Content>
          </Card.Root>
        </button>
      </div>
    </div>
  {/if}
</PageContainer>
