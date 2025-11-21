<script lang="ts">
  import { onMount } from "svelte";

  let mounted = $state(false);

  onMount(() => {
    mounted = true;
  });
</script>

<svelte:head>
  <title>Rhino Compute Template - SvelteKit</title>
</svelte:head>

<div class="min-h-screen bg-linear-to-br from-slate-50 to-slate-100">
  <!-- Hero Section -->
  <div class="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
    <div
      class="text-center transition-all duration-700 {mounted
        ? 'translate-y-0 opacity-100'
        : 'translate-y-4 opacity-0'}"
    >
      <h1 class="mb-4 text-5xl font-bold tracking-tight text-slate-900 sm:text-6xl">
        Rhino Compute
        <span
          class="bg-linear-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent"
        >
          SvelteKit Template
        </span>
      </h1>
      <p class="mx-auto mb-8 max-w-2xl text-lg text-slate-600">
        A production-ready template for building web applications with Grasshopper and Rhino
        Compute. Copy, customize, and start computing in minutes.
      </p>

      <div class="flex flex-wrap justify-center gap-4">
        <a
          href="/compute"
          class="rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white transition-all hover:bg-blue-700 hover:shadow-lg"
        >
          Try Demo
        </a>
        <a
          href="https://github.com/TheVessen/rhino-compute-lib"
          target="_blank"
          rel="noopener noreferrer"
          class="rounded-lg border-2 border-slate-300 bg-white px-6 py-3 font-semibold text-slate-700 transition-all hover:border-slate-400 hover:shadow-lg"
        >
          View on GitHub
        </a>
      </div>
    </div>

    <!-- Features Grid -->
    <div
      class="mt-20 grid gap-8 transition-all delay-150 duration-700 sm:grid-cols-2 lg:grid-cols-3 {mounted
        ? 'translate-y-0 opacity-100'
        : 'translate-y-4 opacity-0'}"
    >
      <div class="rounded-xl bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
        <div class="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-blue-100">
          <svg
            class="h-6 w-6 text-blue-600"
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
        </div>
        <h3 class="mb-2 text-xl font-semibold text-slate-900">Ready to Use</h3>
        <p class="text-slate-600">
          Pre-configured with TypeScript, SvelteKit, and Tailwind CSS. Start building
          immediately without setup hassles.
        </p>
      </div>

      <div class="rounded-xl bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
        <div class="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-green-100">
          <svg
            class="h-6 w-6 text-green-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"
            />
          </svg>
        </div>
        <h3 class="mb-2 text-xl font-semibold text-slate-900">UI Components</h3>
        <p class="text-slate-600">
          Built-in Grasshopper parameter inputs with automatic type detection and validation
          using rhino-compute-ui.
        </p>
      </div>

      <div class="rounded-xl bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
        <div class="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-purple-100">
          <svg
            class="h-6 w-6 text-purple-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M14 10l-2 1m0 0l-2-1m2 1v2.5M20 7l-2 1m2-1l-2-1m2 1v2.5M14 4l-2-1-2 1M4 7l2-1M4 7l2 1M4 7v2.5M12 21l-2-1m2 1l2-1m-2 1v-2.5M6 18l-2-1v-2.5M18 18l2-1v-2.5"
            />
          </svg>
        </div>
        <h3 class="mb-2 text-xl font-semibold text-slate-900">3D Visualization</h3>
        <p class="text-slate-600">
          Integrated Three.js viewer for real-time 3D geometry visualization with orbit
          controls and responsive rendering.
        </p>
      </div>

      <div class="rounded-xl bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
        <div class="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-orange-100">
          <svg
            class="h-6 w-6 text-orange-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
            />
          </svg>
        </div>
        <h3 class="mb-2 text-xl font-semibold text-slate-900">Type Safe</h3>
        <p class="text-slate-600">
          Full TypeScript support with typed API routes, compute responses, and Grasshopper
          parameter handling.
        </p>
      </div>

      <div class="rounded-xl bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
        <div class="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-red-100">
          <svg
            class="h-6 w-6 text-red-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>
        <h3 class="mb-2 text-xl font-semibold text-slate-900">Error Handling</h3>
        <p class="text-slate-600">
          Built-in error and warning display with message overlay component for compute
          errors and validation issues.
        </p>
      </div>

      <div class="rounded-xl bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
        <div class="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-indigo-100">
          <svg
            class="h-6 w-6 text-indigo-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
            />
          </svg>
        </div>
        <h3 class="mb-2 text-xl font-semibold text-slate-900">API Routes</h3>
        <p class="text-slate-600">
          Example API routes for secure server-side compute operations with proper
          environment variable handling.
        </p>
      </div>
    </div>

    <!-- Quick Start Section -->
    <div
      class="mt-20 rounded-2xl bg-white p-8 shadow-sm transition-all delay-300 duration-700 {mounted
        ? 'translate-y-0 opacity-100'
        : 'translate-y-4 opacity-0'}"
    >
      <h2 class="mb-6 text-3xl font-bold text-slate-900">Quick Start</h2>

      <div class="grid gap-6 md:grid-cols-2">
        <div>
          <h3 class="mb-3 text-lg font-semibold text-slate-800">1. Clone & Install</h3>
          <pre
            class="overflow-x-auto rounded-lg bg-slate-900 p-4 text-sm text-slate-100"><code>pnpm install</code></pre>
        </div>

        <div>
          <h3 class="mb-3 text-lg font-semibold text-slate-800">2. Configure Environment</h3>
          <pre
            class="overflow-x-auto rounded-lg bg-slate-900 p-4 text-sm text-slate-100"><code>cp example.env .env</code></pre>
        </div>

        <div>
          <h3 class="mb-3 text-lg font-semibold text-slate-800">
            3. Add Your Grasshopper File
          </h3>
          <pre
            class="overflow-x-auto rounded-lg bg-slate-900 p-4 text-sm text-slate-100"><code>static/your-definition.gh</code></pre>
        </div>

        <div>
          <h3 class="mb-3 text-lg font-semibold text-slate-800">4. Start Development</h3>
          <pre
            class="overflow-x-auto rounded-lg bg-slate-900 p-4 text-sm text-slate-100"><code>pnpm dev</code></pre>
        </div>
      </div>

      <div class="mt-6 rounded-lg bg-blue-50 p-4">
        <p class="text-sm text-blue-900">
          <strong>Note:</strong> Update the Grasshopper file path in
          <code class="rounded bg-blue-100 px-1 py-0.5">src/routes/compute/+page.server.ts</code>
          to point to your definition.
        </p>
      </div>
    </div>

    <!-- What's Included Section -->
    <div
      class="mt-20 transition-all delay-500 duration-700 {mounted
        ? 'translate-y-0 opacity-100'
        : 'translate-y-4 opacity-0'}"
    >
      <h2 class="mb-8 text-center text-3xl font-bold text-slate-900">What's Included</h2>

      <div class="grid gap-4 sm:grid-cols-2">
        <div class="flex items-start gap-3 rounded-lg bg-white p-4 shadow-sm">
          <svg
            class="mt-1 h-5 w-5 shrink-0 text-green-600"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fill-rule="evenodd"
              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
              clip-rule="evenodd"
            />
          </svg>
          <div>
            <strong class="text-slate-900">rhino-compute-core</strong>
            <p class="text-sm text-slate-600">Core library for compute operations</p>
          </div>
        </div>

        <div class="flex items-start gap-3 rounded-lg bg-white p-4 shadow-sm">
          <svg
            class="mt-1 h-5 w-5 shrink-0 text-green-600"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fill-rule="evenodd"
              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
              clip-rule="evenodd"
            />
          </svg>
          <div>
            <strong class="text-slate-900">rhino-compute-ui</strong>
            <p class="text-sm text-slate-600">Svelte 5 UI components</p>
          </div>
        </div>

        <div class="flex items-start gap-3 rounded-lg bg-white p-4 shadow-sm">
          <svg
            class="mt-1 h-5 w-5 shrink-0 text-green-600"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fill-rule="evenodd"
              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
              clip-rule="evenodd"
            />
          </svg>
          <div>
            <strong class="text-slate-900">Three.js Integration</strong>
            <p class="text-sm text-slate-600">3D visualization setup</p>
          </div>
        </div>

        <div class="flex items-start gap-3 rounded-lg bg-white p-4 shadow-sm">
          <svg
            class="mt-1 h-5 w-5 shrink-0 text-green-600"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fill-rule="evenodd"
              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
              clip-rule="evenodd"
            />
          </svg>
          <div>
            <strong class="text-slate-900">Example API Routes</strong>
            <p class="text-sm text-slate-600">Server-side compute endpoints</p>
          </div>
        </div>

        <div class="flex items-start gap-3 rounded-lg bg-white p-4 shadow-sm">
          <svg
            class="mt-1 h-5 w-5 shrink-0 text-green-600"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fill-rule="evenodd"
              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
              clip-rule="evenodd"
            />
          </svg>
          <div>
            <strong class="text-slate-900">Tailwind CSS 4</strong>
            <p class="text-sm text-slate-600">Modern styling framework</p>
          </div>
        </div>

        <div class="flex items-start gap-3 rounded-lg bg-white p-4 shadow-sm">
          <svg
            class="mt-1 h-5 w-5 shrink-0 text-green-600"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fill-rule="evenodd"
              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
              clip-rule="evenodd"
            />
          </svg>
          <div>
            <strong class="text-slate-900">TypeScript Config</strong>
            <p class="text-sm text-slate-600">Strict type checking</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div
      class="mt-20 border-t border-slate-200 pt-8 text-center transition-all delay-700 duration-700 {mounted
        ? 'translate-y-0 opacity-100'
        : 'translate-y-4 opacity-0'}"
    >
      <p class="text-slate-600">
        Built with
        <a
          href="https://github.com/TheVessen/rhino-compute-lib"
          class="font-semibold text-blue-600 hover:underline"
          target="_blank"
          rel="noopener noreferrer">rhino-compute-lib</a
        >
      </p>
    </div>
  </div>
</div>