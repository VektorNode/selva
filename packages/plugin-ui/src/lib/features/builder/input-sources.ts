import type { InputLayoutItem, InputSource, UISchema } from '@selvajs/schemas';

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

/** Placed inputs whose value comes from somewhere other than the form, in layout order. */
export function listSourcedInputs(schema: UISchema): SourcedInput[] {
	const layout = schema.layout;
	const containers =
		layout?.type === 'tabbed'
			? layout.tabs.map((tab) => ({ tabId: tab.id, groups: tab.groups }))
			: layout?.type === 'flat'
				? [{ tabId: '', groups: layout.groups }]
				: [];

	return containers.flatMap(({ tabId, groups }) =>
		groups.flatMap((group) =>
			group.items.flatMap((item): SourcedInput[] => {
				if (item.type !== 'input') return [];
				const kind = item.source?.kind ?? 'user';
				return kind === 'user' ? [] : [{ tabId, groupId: group.id, item, kind }];
			})
		)
	);
}
