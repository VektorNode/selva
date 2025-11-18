<script lang="ts">
  import { page } from "$app/state";
  import { PageContainer, PageHeader } from "$lib/components/layout";
  import { StateDisplay, Button } from "$lib/components/ui";

  var sessionId = page.url.searchParams.get("session");
  let mode: "home" | "builder" | "preview" = "home";

  // Allow switching modes without navigation
  function switchMode(newMode: "builder" | "preview") {
    mode = newMode;
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
    <div class="flex flex-col min-h-screen">
      <PageHeader title="ComputeBuilder" {sessionId}>
        <nav class="flex gap-2">
          <Button
            variant={mode === "home" ? "default" : "outline"}
            size="sm"
            onclick={() => (mode = "home")}
          >
            Home
          </Button>
          <Button
            variant={mode === "builder" ? "default" : "outline"}
            size="sm"
            onclick={() => switchMode("builder")}
          >
            Schema Builder
          </Button>
          <Button
            variant={mode === "preview" ? "default" : "outline"}
            size="sm"
            onclick={() => switchMode("preview")}
          >
            Interactive Preview
          </Button>
        </nav>
      </PageHeader>

      <main class="flex-1 flex flex-col">
        {#if mode === "home"}
          <div class="p-12 max-w-4xl mx-auto w-full">
            <h2 class="text-4xl font-bold mb-4 text-foreground">Welcome to ComputeBuilder</h2>
            <p class="text-muted-foreground mb-8 text-lg">
              Choose a mode to get started:
            </p>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
              <button
                class="bg-card border-2 border-border rounded-lg p-8 text-left hover:border-primary hover:shadow-lg transition-all transform hover:-translate-y-1"
                onclick={() => switchMode("builder")}
              >
                <h3 class="text-2xl font-semibold mb-3 text-foreground">🔧 Schema Builder</h3>
                <p class="text-muted-foreground leading-relaxed">
                  Configure your UI schema by selecting inputs and outputs from
                  your Grasshopper definition
                </p>
              </button>

              <button
                class="bg-card border-2 border-border rounded-lg p-8 text-left hover:border-primary hover:shadow-lg transition-all transform hover:-translate-y-1"
                onclick={() => switchMode("preview")}
              >
                <h3 class="text-2xl font-semibold mb-3 text-foreground">
                  ⚡ Interactive Preview
                </h3>
                <p class="text-muted-foreground leading-relaxed">
                  Interact with your Grasshopper definition in real-time with
                  live parameter updates
                </p>
              </button>
            </div>
          </div>
        {:else if mode === "builder"}
          <iframe
            src="/builder?session={sessionId}"
            title="Schema Builder"
            class="flex-1 w-full border-none"
          ></iframe>
        {:else if mode === "preview"}
          <iframe
            src="/preview?session={sessionId}"
            title="Interactive Preview"
            class="flex-1 w-full border-none"
          ></iframe>
        {/if}
      </main>
    </div>
  {/if}
</PageContainer>
