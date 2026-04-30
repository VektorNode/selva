import type { DiscoveredInput, DiscoveredOutput, LayoutItem, TabConfig } from '@selvajs/schemas';

export interface GroupItemDragData {
	item: LayoutItem;
	tabId: string;
	groupId: string;
}

export type DragPayload =
	| { dropType: 'input'; data: DiscoveredInput }
	| { dropType: 'output'; data: DiscoveredOutput }
	| { dropType: 'group-item'; data: GroupItemDragData }
	| { dropType: 'group' | 'tab'; data: TabConfig };

/** @deprecated use DragPayload */
export type DragData = DragPayload;

class DragStore {
	private _data = $state<DragPayload | null>(null);

	get current() {
		return this._data;
	}

	set(data: DragPayload | null) {
		this._data = data;
	}

	clear() {
		this._data = null;
	}
}

export const dragStore = new DragStore();
