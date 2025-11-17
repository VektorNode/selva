<script lang="ts">
  import { page } from "$app/state";
  import {
    PageContainer,
    PageHeader,
    StateDisplay,
    Button,
  } from "$lib/components/shared";

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
            variant={mode === "home" ? "primary" : "secondary"}
            size="small"
            onclick={() => (mode = "home")}
          >
            Home
          </Button>
          <Button
            variant={mode === "builder" ? "primary" : "secondary"}
            size="small"
            onclick={() => switchMode("builder")}
          >
            Schema Builder
          </Button>
          <Button
            variant={mode === "preview" ? "primary" : "secondary"}
            size="small"
            onclick={() => switchMode("preview")}
          >
            Interactive Preview
          </Button>
        </nav>
      </PageHeader>

      <main class="flex-1 flex flex-col">
        {#if mode === "home"}
          <div class="p-12 max-w-4xl mx-auto w-full">
            <h2 class="text-4xl font-bold mb-4">Welcome to ComputeBuilder</h2>
            <p class="text-gray-600 mb-8 text-lg">
              Choose a mode to get started:
            </p>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
              <button
                class="bg-white border-2 border-gray-200 rounded-lg p-8 text-left hover:border-blue-600 hover:shadow-lg transition-all transform hover:-translate-y-1"
                onclick={() => switchMode("builder")}
              >
                <h3 class="text-2xl font-semibold mb-3">🔧 Schema Builder</h3>
                <p class="text-gray-600 leading-relaxed">
                  Configure your UI schema by selecting inputs and outputs from
                  your Grasshopper definition
                </p>
              </button>

              <button
                class="bg-white border-2 border-gray-200 rounded-lg p-8 text-left hover:border-blue-600 hover:shadow-lg transition-all transform hover:-translate-y-1"
                onclick={() => switchMode("preview")}
              >
                <h3 class="text-2xl font-semibold mb-3">
                  ⚡ Interactive Preview
                </h3>
                <p class="text-gray-600 leading-relaxed">
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
