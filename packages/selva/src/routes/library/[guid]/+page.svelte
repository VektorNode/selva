<script lang="ts">
	import type { PageProps } from './$types';
	import { ComputeApp } from '@selvajs/ui';
	import { createComputeFetchSolveFn } from '@selvajs/solve/client';
	import { getThreeObjectsFromComputeResponse } from '@selvajs/visualization/parse';
	import ServerFooter from '$lib/components/ServerFooter.svelte';
	import UserChip from '$lib/components/UserChip.svelte';
	import MainNav from '$lib/components/MainNav.svelte';
	import SettingsMenu from '$lib/components/SettingsMenu.svelte';
	import { page } from '$app/state';
	import type { OrgPermission, PlatformPermission } from '@selvajs/platform';

	let { data }: PageProps = $props();

	// Reachable anonymously through a share token, so the app nav is gated on a real session.
	const pageData = $derived(
		page.data as {
			user?: { platformPermissions?: PlatformPermission[] } | null;
			ctx?: { orgPermissions?: OrgPermission[] } | null;
			branding?: { name: string };
		}
	);
	const isAuthed = $derived(!!pageData.user);

	function shouldShowViewer(): boolean {
		return Boolean(
			data.schema.viewerOptions?.enableLocal || data.schema.viewerOptions?.enableRemote
		);
	}

	const onSolve = createComputeFetchSolveFn({
		endpoint: '/api/v1/compute',
		definitionUrl: () => data.ghDefinition,
		inputs: () => data.schema.inputs,
		outputs: () => data.schema.outputs,
		channel: () => (data.channel === 'draft' ? 'draft' : undefined),
		versionId: () => data.versionId,
		meshes: shouldShowViewer()
			? { extract: (response, opts) => getThreeObjectsFromComputeResponse(response, opts) }
			: undefined,
		debug: true
	});
</script>

<ComputeApp
	schema={data.schema}
	{onSolve}
	definitionKey={data.currentDefinition}
	title={data.schema?.name || data.schema.description}
	logo={data.orgLogoUrl ?? undefined}
	showModeToggle={true}
	brandName={pageData.branding?.name}
	homeUrl="/"
	solveDeadlineMs={data.solveDeadlineMs}
	footerComponent={ServerFooter}
	footerComponentProps={() => ({ label: data.serverLabel })}
>
	{#snippet navItems()}
		{#if isAuthed}
			<MainNav />
		{/if}
	{/snippet}

	{#snippet headerRight()}
		{#if data.versionId}
			<span
				class="bg-warning/15 text-warning rounded-full px-2.5 py-1 font-mono text-[11px] font-medium tracking-wide uppercase"
			>
				v{data.versionNumber} preview
			</span>
		{:else if data.channel === 'draft'}
			<span
				class="bg-warning/15 text-warning rounded-full px-2.5 py-1 font-mono text-[11px] font-medium tracking-wide uppercase"
			>
				Draft preview
			</span>
		{/if}
		{#if isAuthed}
			<UserChip />
			<SettingsMenu
				platformPermissions={pageData.user?.platformPermissions ?? []}
				orgPermissions={pageData.ctx?.orgPermissions ?? []}
			/>
		{/if}
	{/snippet}
</ComputeApp>
