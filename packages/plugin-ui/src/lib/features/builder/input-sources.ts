import type { GroupConfig, InputLayoutItem, InputSource, UISchema } from '@selvajs/schemas';

export type SourceKind = InputSource['kind'];

export const SOURCE_KIND_LABELS: Record<SourceKind, string> = {
	user: 'Form',
	client: 'Client app',
	server: 'Server'
};

export interface SourcedInput {
	/** The tab holding the item; '' in a flat layout. */
	tabId: string;
	groupId: string;
	item: InputLayoutItem;
	kind: Exclude<SourceKind, 'user'>;
}

/** The layout's group lists, under one shape for both layouts. `tabId` is '' in a flat layout. */
export function layoutContainers(
	schema: UISchema
): { tabId: string; tabLabel?: string; groups: GroupConfig[] }[] {
	const layout = schema.layout;
	if (layout?.type === 'tabbed') {
		return layout.tabs.map((tab) => ({ tabId: tab.id, tabLabel: tab.label, groups: tab.groups }));
	}
	return layout?.type === 'flat' ? [{ tabId: '', groups: layout.groups }] : [];
}

/** Placed inputs whose value comes from somewhere other than the form, in layout order. */
export function listSourcedInputs(schema: UISchema): SourcedInput[] {
	return layoutContainers(schema).flatMap(({ tabId, groups }) =>
		groups.flatMap((group) =>
			group.items.flatMap((item): SourcedInput[] => {
				if (item.type !== 'input') return [];
				const kind = item.source?.kind ?? 'user';
				return kind === 'user' ? [] : [{ tabId, groupId: group.id, item, kind }];
			})
		)
	);
}
