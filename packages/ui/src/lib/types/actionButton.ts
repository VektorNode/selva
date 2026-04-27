/**
 * Defines an action button for use in the UI.
 *
 * @example
 * ```typescript
 * const saveButton: ActionButton = {
 *   id: 'save-btn',
 *   label: 'Save Changes',
 *   icon: SaveIcon,
 *   variant: 'default',
 *   size: 'lg',
 *   onclick: async () => {
 *     await saveData();
 *     showNotification('Saved!');
 *   }
 * };
 * ```
 *
 * @property id - Unique identifier for this button
 * @property label - Display text shown on the button
 * @property icon - Optional icon component to display alongside the label
 * @property variant - Button styling variant (controls color/appearance)
 * @property size - Button size preset
 * @property onclick - Callback function executed when clicked; can be async
 */
export interface ActionButton {
	id: string;
	label: string;
	icon?: any;
	variant?: 'default' | 'outline' | 'destructive' | 'secondary' | 'ghost';
	size?: 'default' | 'sm' | 'lg';
	onclick: () => void | Promise<void>;
}
