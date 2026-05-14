<script>
	import { page } from '$app/state';
	import { ErrorScreen } from '@selvajs/ui';
</script>

<div class="px-6 py-6">
	<ErrorScreen status={page.status} message={page.error?.message} />
</div>
