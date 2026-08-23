<script lang="ts">
	import { statusRing, statusDot } from './statusStyles';

	interface Props {
		status: string;
		class?: string;
	}

	let { status, class: className = '' }: Props = $props();
</script>

<span
	class="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[11px] tracking-wide {statusRing(
		status
	)} {className}"
>
	<span class="h-1.5 w-1.5 rounded-full {statusDot(status)}"></span>
	{status}
</span>
