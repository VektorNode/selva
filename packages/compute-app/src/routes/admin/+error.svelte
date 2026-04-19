<script>
	import { page } from '$app/state';
	import { ErrorScreen } from 'selva-shared';
</script>

<div class="p-6 lg:px-12 xl:px-16">
	<ErrorScreen status={page.status} message={page.error?.message} />
</div>
