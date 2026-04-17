export interface NotificationManager {
	show(message: string, duration?: number): void;
	clear(): void;
}

export function createNotificationManager(): {
	manager: NotificationManager;
	getMessage: () => string;
	setMessage: (msg: string) => void;
} {
	let message = $state('');
	let timer: ReturnType<typeof setTimeout> | null = null;

	const manager: NotificationManager = {
		show(msg: string, duration = 3000) {
			message = msg;
			if (timer) {
				clearTimeout(timer);
			}
			timer = setTimeout(() => {
				message = '';
				timer = null;
			}, duration);
		},
		clear() {
			message = '';
			if (timer) {
				clearTimeout(timer);
				timer = null;
			}
		}
	};

	return {
		manager,
		getMessage: () => message,
		setMessage: (msg: string) => {
			message = msg;
		}
	};
}

export function formatParameterUpdateMessage(removedCount: number): string {
	if (removedCount === 0) return '';
	return `Schema updated: ${removedCount} parameter${removedCount > 1 ? 's' : ''} removed`;
}

export function formatMetadataUpdateMessage(updatedNames: string[]): string {
	const count = updatedNames.length;
	if (count === 0) return '';
	return `Parameter${count > 1 ? 's' : ''} updated: ${updatedNames.join(', ')}`;
}
