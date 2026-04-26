<script>
	import { page } from '$app/state';
	import { ErrorScreen } from '@selvajs/shared';
</script>

<ErrorScreen
	status={page.status}
	message={page.error?.message}
	details={page.error && typeof page.error === 'object' && 'details' in page.error
		? page.error.details
		: undefined}
/>
