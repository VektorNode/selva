<script lang="ts">
    import type { ComputeConfig } from 'rhino-compute-core';
    import {
        fetchParsedDefinitionIO,
        inputsToDataTrees,
        solveGrasshopperDefinition,
        GrasshopperResponseProcessor
    } from 'rhino-compute-core/grasshopper';
    import type { RhinoModule } from 'rhino3dm';
    import type { GrasshopperOutput } from './types';



    // State
    let ghFileUrl = $state("");
    let serverUrl = $state('http://localhost:5000');
    let apiKey = $state('');
    let isLoading = $state(false);
    let error = $state('');
    let generatedTypes = $state('');
    let parsedValues = $state<Record<string, any> | null>(null);
    let copySuccess = $state(false);

    async function loadRhino3dm(): Promise<RhinoModule> {
        // Import rhino3dm from CDN for WASM initialization
        const rhino3dmModule = await import(
            //@ts-ignore
            'https://unpkg.com/rhino3dm@8.17.0/rhino3dm.module.min.js'
        );
        return await rhino3dmModule.default();
    }

    async function generateTypes() {
        isLoading = true;
        error = '';
        generatedTypes = '';
        parsedValues = null;
        copySuccess = false;

        try {
            // Validate inputs
            if (!ghFileUrl.trim()) {
                throw new Error('Please provide a Grasshopper file URL');
            }
            if (!serverUrl.trim()) {
                throw new Error('Please provide a compute server URL');
            }

            const serverConfig: ComputeConfig = {
                serverUrl: serverUrl.trim(),
                apiKey: apiKey.trim() || undefined
            };

            // Fetch definition IO
            const definition = await fetchParsedDefinitionIO(
                ghFileUrl.trim(),
                serverConfig
            );

            // Convert inputs to data trees
            const inputs = inputsToDataTrees(definition.inputs);

            // Solve the definition
            const solvedDefinition = await solveGrasshopperDefinition(
                inputs,
                ghFileUrl.trim(),
                serverConfig
            );

            // Process the response
            const resultProcessor = new GrasshopperResponseProcessor(
                solvedDefinition
            );

            // Load rhino3dm WASM module
            const rhino = await loadRhino3dm();

            // Get values with TypeScript type generation
            const { values, types } = resultProcessor.getValues<GrasshopperOutput>({
                generateTypes: true,
                rhino
            });

            if (!types) {
                throw new Error('Failed to generate types');
            }

            generatedTypes = types.fullType;
            parsedValues = values;
        } catch (err) {
            error =
                err instanceof Error
                    ? err.message
                    : 'An unknown error occurred';
            console.error('Error generating types:', err);
        } finally {
            isLoading = false;
        }
    }

    async function copyToClipboard() {
        try {
            await navigator.clipboard.writeText(generatedTypes);
            copySuccess = true;
            setTimeout(() => {
                copySuccess = false;
            }, 2000);
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    }
</script>

<div class="min-h-screen bg-linear-to-br from-slate-50 to-slate-100 p-4 sm:p-8">
  <div class="mx-auto max-w-5xl">
    <!-- Header -->
    <div class="mb-8">
      <h1 class="mb-2 text-3xl font-bold text-slate-900 sm:text-4xl">
        🦏 Grasshopper TypeScript Generator
      </h1>
      <p class="text-base text-slate-600 sm:text-lg">
        Automatically generate TypeScript types from your Grasshopper definition
        outputs
      </p>
    </div>

    <!-- Getting Started Guide -->
    <div
      class="mb-8 rounded-xl bg-linear-to-br from-blue-50 to-indigo-50 p-6 shadow-lg border border-blue-100"
    >
      <div class="flex items-start gap-3 mb-4">
        <svg
          class="w-6 h-6 text-blue-600 mt-0.5 shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          ></path>
        </svg>
        <div>
          <h2 class="text-lg font-bold text-blue-900 mb-2">Getting Started</h2>
          <div class="space-y-3 text-sm text-blue-800">
            <div class="flex items-start gap-2">
              <span class="font-bold text-blue-900 mt-0.5">1.</span>
              <div>
                <strong>Setup Rhino Compute Server:</strong> You need a running Rhino
                Compute server.
              </div>
            </div>
            <div class="flex items-start gap-2">
              <span class="font-bold text-blue-900 mt-0.5">2.</span>
              <div>
                <strong>Host Your .gh File:</strong> Upload your Grasshopper definition
                to a publicly accessible URL (Firebase Storage, AWS S3, GitHub, etc.)
                or put it in the static folder if running locally.
              </div>
            </div>
            <div class="flex items-start gap-2">
              <span class="font-bold text-blue-900 mt-0.5">3.</span>
              <div>
                <strong>Generate Types:</strong> Fill in the form below, and this
                tool will solve your definition and generate TypeScript interfaces
                for all outputs.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Input Form -->
    <div class="mb-8 rounded-xl bg-white p-6 shadow-lg border border-slate-200">
      <div class="flex items-center gap-2 mb-4">
        <svg
          class="w-5 h-5 text-slate-700"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
          ></path>
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
          ></path>
        </svg>
        <h2 class="text-xl font-bold text-slate-900">Configuration</h2>
      </div>

      <div class="space-y-5">
        <!-- Grasshopper File URL -->
        <div>
          <label
            for="ghUrl"
            class="mb-2 block text-sm font-semibold text-slate-700"
          >
            Grasshopper File URL <span class="text-red-500">*</span>
          </label>
          <input
            id="ghUrl"
            type="url"
            bind:value={ghFileUrl}
            placeholder="https://example.com/my-definition.gh"
            class="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
          />
          <p class="mt-1.5 text-xs text-slate-500 flex items-start gap-1.5">
            <svg
              class="w-4 h-4 shrink-0 mt-0.5 text-slate-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              ></path>
            </svg>
            <span>Publicly accessible URL to your .gh or .ghx file</span>
          </p>
        </div>

        <!-- Server URL -->
        <div>
          <label
            for="serverUrl"
            class="mb-2 block text-sm font-semibold text-slate-700"
          >
            Compute Server URL <span class="text-red-500">*</span>
          </label>
          <input
            id="serverUrl"
            type="url"
            bind:value={serverUrl}
            placeholder="http://localhost:5000"
            class="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
          />
          <p class="mt-1.5 text-xs text-slate-500 flex items-start gap-1.5">
            <svg
              class="w-4 h-4 shrink-0 mt-0.5 text-slate-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              ></path>
            </svg>
            <span
              >Local server (e.g., http://localhost:5000) or hosted compute
              endpoint</span
            >
          </p>
        </div>

        <!-- API Key (Optional) -->
        <div>
          <label
            for="apiKey"
            class="mb-2 block text-sm font-semibold text-slate-700"
          >
            API Key <span class="text-slate-400 font-normal">(optional)</span>
          </label>
          <input
            id="apiKey"
            type="password"
            bind:value={apiKey}
            placeholder="Enter API key if required"
            class="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
          />
          <p class="mt-1.5 text-xs text-slate-500 flex items-start gap-1.5">
            <svg
              class="w-4 h-4 shrink-0 mt-0.5 text-slate-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              ></path>
            </svg>
            <span
              >Only needed if your compute server requires authentication</span
            >
          </p>
        </div>

        <!-- Generate Button -->
        <button
          onclick={generateTypes}
          disabled={isLoading}
          class="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-6 py-3 font-medium text-white transition-all hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-400 sm:w-auto"
        >
          {#if isLoading}
            <svg class="h-5 w-5 animate-spin" viewBox="0 0 24 24">
              <circle
                class="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                stroke-width="4"
                fill="none"
              />
              <path
                class="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            <span>Generating Types...</span>
          {:else}
            <svg
              class="h-5 w-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
            <span>Generate TypeScript Types</span>
          {/if}
        </button>
      </div>
    </div>

    <!-- Error Message -->
    {#if error}
      <div class="mb-8 rounded-xl bg-red-50 p-6 shadow-lg">
        <div class="flex items-start gap-3">
          <svg
            class="mt-0.5 h-6 w-6 shrink-0 text-red-600"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
          >
            <circle cx="12" cy="12" r="10" stroke-width="2" />
            <path
              d="M12 8v4M12 16h.01"
              stroke-width="2"
              stroke-linecap="round"
            />
          </svg>
          <div class="flex-1">
            <h3 class="mb-1 font-bold text-red-900">Error</h3>
            <p class="text-red-800">{error}</p>
          </div>
        </div>
      </div>
    {/if}

    <!-- Results -->
    {#if generatedTypes}
      <div class="space-y-6">
        <!-- Generated TypeScript Types -->
        <div class="rounded-xl bg-white p-6 shadow-lg">
          <div class="mb-4 flex items-center justify-between">
            <h2 class="text-xl font-bold text-slate-900">
              Generated TypeScript Types
            </h2>
            <button
              onclick={copyToClipboard}
              class="inline-flex items-center gap-2 rounded-lg bg-slate-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-600"
            >
              {#if copySuccess}
                <svg
                  class="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                <span>Copied!</span>
              {:else}
                <svg
                  class="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                  />
                </svg>
                <span>Copy to Clipboard</span>
              {/if}
            </button>
          </div>

          <div class="overflow-x-auto rounded-lg bg-slate-900">
            <pre class="p-4 text-sm text-slate-100"><code>{generatedTypes}</code
              ></pre>
          </div>

          <div
            class="mt-6 rounded-lg bg-linear-to-br from-green-50 to-emerald-50 p-5 border border-green-200"
          >
            <div class="flex items-start gap-2 mb-3">
              <svg
                class="w-5 h-5 text-green-700 shrink-0 mt-0.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                ></path>
              </svg>
              <div class="flex-1">
                <h3 class="mb-2 font-bold text-green-900">
                  How to use in your project:
                </h3>
                <ol class="space-y-2.5 text-sm text-green-800">
                  <li class="flex gap-2">
                    <span class="font-bold shrink-0">1.</span>
                    <span
                      >Click "Copy to Clipboard" above to copy the generated
                      TypeScript interface</span
                    >
                  </li>
                  <li class="flex gap-2">
                    <span class="font-bold shrink-0">2.</span>
                    <div>
                      Create a new file in your project:
                      <code
                        class="ml-1 rounded bg-green-100 px-1.5 py-0.5 font-mono text-xs"
                        >src/types/types.ts</code
                      >
                    </div>
                  </li>
                  <li class="flex gap-2">
                    <span class="font-bold shrink-0">3.</span>
                    <span>Paste the interface into that file</span>
                  </li>
                  <li class="flex gap-2">
                    <span class="font-bold shrink-0">4.</span>
                    <div>
                      Use it with type safety in your code:
                      <pre
                        class="mt-2 rounded bg-green-100 p-2 font-mono text-xs overflow-x-auto">
<code
                          >import type &#123; GrasshopperOutput &#125; from './types/types.ts';

const processor = new GrasshopperResponseProcessor(result);
const &#123; values &#125; = processor.getValues&lt;GrasshopperOutput&gt;();

// Now you have full TypeScript autocomplete!
console.log(values.myOutputParameter); // ✓ Type-safe</code
                        ></pre>
                    </div>
                  </li>
                </ol>
              </div>
            </div>
          </div>
        </div>

        <!-- Parsed Values Preview -->
        {#if parsedValues && Object.keys(parsedValues).length > 0}
          <div
            class="rounded-xl bg-white p-6 shadow-lg border border-slate-200"
          >
            <div class="flex items-center gap-2 mb-4">
              <svg
                class="w-5 h-5 text-slate-700"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                ></path>
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                ></path>
              </svg>
              <h2 class="text-xl font-bold text-slate-900">
                Parsed Values Preview
              </h2>
            </div>

            <p class="text-sm text-slate-500 mb-4">
              Sample output values from solving your definition (with scrollable
              content for long values)
            </p>

            <div class="space-y-3 max-h-[600px] overflow-y-auto pr-2">
              {#each Object.entries(parsedValues) as [key, value]}
                <div
                  class="rounded-lg bg-slate-50 p-4 transition-colors hover:bg-slate-100 border border-slate-200"
                >
                  <div class="flex items-start justify-between gap-3 mb-2">
                    <div class="font-semibold text-slate-900">{key}</div>
                    <span
                      class="text-xs px-2 py-1 rounded bg-slate-200 text-slate-600 shrink-0"
                    >
                      {typeof value === "object" && value !== null
                        ? Array.isArray(value)
                          ? "array"
                          : "object"
                        : typeof value}
                    </span>
                  </div>
                  <div
                    class="max-h-[300px] overflow-auto rounded bg-slate-900 p-3"
                  >
                    <pre
                      class="font-mono text-xs text-slate-100 whitespace-pre-wrap break-all">{JSON.stringify(
                        value,
                        null,
                        2,
                      )}</pre>
                  </div>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    {/if}

    <!-- Info Section -->
    {#if !generatedTypes && !isLoading && !error}
      <div
        class="rounded-xl bg-linear-to-br from-purple-50 to-pink-50 p-6 shadow-lg border border-purple-100"
      >
        <div class="flex items-start gap-3 mb-3">
          <svg
            class="w-6 h-6 text-purple-600 shrink-0 mt-0.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
            ></path>
          </svg>
          <div>
            <h3 class="text-lg font-bold text-purple-900 mb-3">How It Works</h3>
            <div class="space-y-3 text-sm text-purple-800">
              <div class="flex items-start gap-2.5">
                <div
                  class="w-6 h-6 rounded-full bg-purple-200 shrink-0 flex items-center justify-center font-bold text-purple-900 text-xs"
                >
                  1
                </div>
                <div>
                  <strong class="text-purple-900"
                    >Fetches your definition:</strong
                  > Downloads your .gh file and analyzes its structure
                </div>
              </div>
              <div class="flex items-start gap-2.5">
                <div
                  class="w-6 h-6 rounded-full bg-purple-200 shrink-0 flex items-center justify-center font-bold text-purple-900 text-xs"
                >
                  2
                </div>
                <div>
                  <strong class="text-purple-900">Solves with defaults:</strong>
                  Runs your definition on the compute server using default input
                  values
                </div>
              </div>
              <div class="flex items-start gap-2.5">
                <div
                  class="w-6 h-6 rounded-full bg-purple-200 shrink-0 flex items-center justify-center font-bold text-purple-900 text-xs"
                >
                  3
                </div>
                <div>
                  <strong class="text-purple-900">Analyzes outputs:</strong> Inspects
                  all output parameters and their data types
                </div>
              </div>
              <div class="flex items-start gap-2.5">
                <div
                  class="w-6 h-6 rounded-full bg-purple-200 shrink-0 flex items-center justify-center font-bold text-purple-900 text-xs"
                >
                  4
                </div>
                <div>
                  <strong class="text-purple-900">Generates TypeScript:</strong>
                  Creates a type-safe interface with proper Rhino geometry types
                  (Point3d, Line, Curve, Brep, Mesh, etc.)
                </div>
              </div>
              <div class="flex items-start gap-2.5">
                <div
                  class="w-6 h-6 rounded-full bg-purple-200 shrink-0 flex items-center justify-center font-bold text-purple-900 text-xs"
                >
                  5
                </div>
                <div>
                  <strong class="text-purple-900">Copy & use:</strong> Use the generated
                  interface in your project for full IDE autocomplete and type safety
                </div>
              </div>
            </div>

            <div class="mt-4 pt-4 border-t border-purple-200">
              <p class="text-xs text-purple-700">
                <strong>💡 Pro tip:</strong> This tool uses
                <code class="bg-purple-100 px-1 rounded"
                  >rhino-compute-core</code
                > library. The same workflow can be integrated into your own applications
                for dynamic type generation.
              </p>
            </div>
          </div>
        </div>
      </div>
    {/if}

    <!-- Footer -->
    <div class="mt-8 pt-6 border-t border-slate-200">
      <div
        class="flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-slate-600"
      >
        <div class="flex items-center gap-2">
          <span>Built with</span>
          <a
            href="https://github.com/TheVessen/rhino-compute-lib"
            target="_blank"
            rel="noopener noreferrer"
            class="font-semibold text-blue-600 hover:text-blue-700 hover:underline"
          >
            rhino-compute-lib
          </a>
        </div>
        <div class="flex items-center gap-4">
          <a
            href="https://github.com/mcneel/compute.rhino3d"
            target="_blank"
            rel="noopener noreferrer"
            class="text-slate-600 hover:text-slate-900 hover:underline flex items-center gap-1"
          >
            <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path
                d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"
              />
            </svg>
            Compute Docs
          </a>
          <a
            href="https://www.rhino3d.com/compute/"
            target="_blank"
            rel="noopener noreferrer"
            class="text-slate-600 hover:text-slate-900 hover:underline"
          >
            Rhino Compute
          </a>
        </div>
      </div>
    </div>
  </div>
</div>
