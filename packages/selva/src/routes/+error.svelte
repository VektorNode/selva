<script>
	import { page } from '$app/state';
	import { ErrorScreen } from '@selvajs/ui';
</script>

<ErrorScreen status={page.status} message={page.error?.message} />
