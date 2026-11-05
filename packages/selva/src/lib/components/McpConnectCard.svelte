<script lang="ts">
	import { Button, Card, Tabs } from '@selvajs/ui';
	import { Check, Copy } from '@lucide/svelte';
	import { page } from '$app/state';

	// The token just minted, if any, so the snippets are ready to paste.
	let { secret }: { secret: string | null } = $props();

	const url = $derived(`${page.url.origin}/mcp`);
	const auth = $derived(`Bearer ${secret ?? 'selva_…'}`);

	const pretty = (value: unknown) => JSON.stringify(value, null, 2);

	interface Client {
		id: string;
		label: string;
		/** HTML: holds markup only, never interpolated user data. */
		how: string;
		snippet: string;
	}

	// Each client's config shape is its own; a key in the wrong place is silently ignored.
	const clients = $derived<Client[]>([
		{
			id: 'oauth',
			label: 'Sign in with browser',
			how: 'Clients that support MCP sign-in (claude.ai and ChatGPT connectors, Claude Desktop, and others) need only this URL, no token. The first time it’s used, Selva opens in your browser so you can sign in and choose what the client may do. That creates a token on this page, which you can revoke.',
			snippet: url
		},
		{
			id: 'claude-code',
			label: 'Claude Code',
			how: 'Run this in a terminal, then restart Claude Code.',
			snippet: `claude mcp add --transport http selva ${url} \\\n  --header "Authorization: ${auth}"`
		},
		{
			id: 'cursor',
			label: 'Cursor',
			how: 'Add this to <code class="font-mono">~/.cursor/mcp.json</code>, or <code class="font-mono">.cursor/mcp.json</code> in a project.',
			snippet: pretty({ mcpServers: { selva: { url, headers: { Authorization: auth } } } })
		},
		{
			id: 'vscode',
			label: 'VS Code',
			how: 'Add this to <code class="font-mono">.vscode/mcp.json</code> in your workspace, or run <strong>MCP: Open User Configuration</strong>.',
			snippet: pretty({
				servers: { selva: { type: 'http', url, headers: { Authorization: auth } } }
			})
		},
		{
			id: 'other',
			label: 'Other',
			how: 'Any client that supports remote MCP servers over streamable HTTP takes the URL and an <code class="font-mono">Authorization</code> header. Most read a config shaped like this:',
			snippet: pretty({
				mcpServers: { selva: { type: 'http', url, headers: { Authorization: auth } } }
			})
		}
	]);

	let copiedText = $state<string | null>(null);

	async function copy(text: string) {
		await navigator.clipboard.writeText(text);
		copiedText = text;
	}
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>Connect an AI agent</Card.Title>
		<Card.Description>
			Give an AI assistant access to your definitions over MCP. It can find definitions, read their
			inputs and run solves, with exactly the access its token has. Pick
			<strong>Read and run solves</strong> to let it solve; a Read token sees no solve tool. The address
			below goes into your assistant's settings; it isn't a page to open in a browser.
		</Card.Description>
	</Card.Header>
	<Card.Content>
		<Tabs.Root value="oauth">
			<Tabs.List class="flex-wrap">
				{#each clients as client (client.id)}
					<Tabs.Trigger value={client.id}>{client.label}</Tabs.Trigger>
				{/each}
			</Tabs.List>

			{#each clients as client (client.id)}
				<Tabs.Content value={client.id}>
					<div class="space-y-2 pt-3">
						<p class="text-muted-foreground text-sm">
							<!-- eslint-disable-next-line svelte/no-at-html-tags -- static markup from `clients` above -->
							{@html client.how}
						</p>
						<div class="relative">
							<pre
								class="bg-muted overflow-x-auto rounded-md p-3 pr-12 font-mono text-xs leading-relaxed">{client.snippet}</pre>
							<Button
								size="icon-sm"
								variant="ghost"
								class="absolute top-1.5 right-1.5"
								onclick={() => copy(client.snippet)}
								aria-label="Copy"
							>
								{#if copiedText === client.snippet}<Check />{:else}<Copy />{/if}
							</Button>
						</div>
					</div>
				</Tabs.Content>
			{/each}
		</Tabs.Root>
		{#if !secret}
			<p class="text-muted-foreground mt-3 text-xs">
				For the token-based setups, replace <code class="font-mono">selva_…</code> with your token. Create
				one above and the snippets fill it in.
			</p>
		{/if}
	</Card.Content>
</Card.Root>
