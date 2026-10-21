<script lang="ts">
	import { SCOPES, type Scope } from './scopes';

	interface Props {
		scope: Exclude<Scope, 'shared'>;
		label: string;
		title?: string;
	}

	let { scope, label, title }: Props = $props();

	const mark = $derived(SCOPES[scope]);
</script>

<span
	{title}
	class="inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold {mark.chip}"
>
	<mark.icon size={10} strokeWidth={2.5} aria-hidden="true" />
	{label}
</span>
