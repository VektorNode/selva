export const STATUS_RING: Record<string, string> = {
	draft: 'bg-muted text-muted-foreground border-border',
	review:
		'bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950/30 dark:text-yellow-400 dark:border-yellow-800',
	published:
		'bg-green-50 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-400 dark:border-green-800',
	archived: 'bg-muted text-muted-foreground border-border opacity-60',
	pending: 'bg-muted text-muted-foreground border-border'
};

export const STATUS_DOT: Record<string, string> = {
	draft: 'bg-muted-foreground',
	review: 'bg-yellow-500',
	published: 'bg-green-500',
	archived: 'bg-muted-foreground',
	pending: 'bg-muted-foreground'
};

export const statusRing = (s: string) => STATUS_RING[s] ?? STATUS_RING.draft;
export const statusDot = (s: string) => STATUS_DOT[s] ?? STATUS_DOT.draft;

const PROJECT_COLORS = ['#4f7c4f', '#4f6a7c', '#7c4f4f', '#7c6a4f', '#6a4f7c', '#4f7c6a'];

export function projectColor(id: string) {
	let h = 0;
	for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffffffff;
	return PROJECT_COLORS[Math.abs(h) % PROJECT_COLORS.length];
}

export function formatUpdated(iso: string) {
	const diff = Date.now() - new Date(iso).getTime();
	const mins = Math.floor(diff / 60000);
	if (mins < 60) return `${mins}m`;
	const h = Math.floor(mins / 60);
	if (h < 24) return `${h}h`;
	const d = Math.floor(h / 24);
	if (d < 7) return `${d}d`;
	return `${Math.floor(d / 7)}w`;
}
