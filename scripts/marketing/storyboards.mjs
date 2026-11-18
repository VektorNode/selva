// What the preview video of each example does, in the order a person showing it off would.
// An example without an entry gets the generic tour in plugin.mjs.
//
// Steps:
//   ['tab', 'Cabinets']             open a form tab
//   ['pick', 'Navy']                click an option tile, by its label
//   ['switch', 'Wall units']        flip a checkbox or switch
//   ['slide', 'Span (m)', 0.7]      drag a slider to that fraction of its track
//   ['choose', 'Bays', 2]           open a field's dropdown, take an option by index or text
//   ['dropdown', 6, 'Glazed door']  the open tab's nth dropdown, for rows that repeat one label
//   ['orbit', 120, -10]             drag the view by that many pixels
//   ['night']                       toggle the night look
//   ['look', 'Studio']              change the display look
//   ['scroll', 300]                 scroll the form
//   ['wait', 1200]
//
// `reset` runs off camera, so a take always starts from the same form. `zoom` is wheel steps
// into the view. `node scripts/marketing/inventory.mjs` lists a live form's labels.

export const storyboards = {
	'kitchen-run': {
		reset: [
			['pick', 'Straight'],
			['pick', 'Shaker'],
			['pick', 'Sage'],
			['pick', 'Oak']
		],
		preview: [
			['pick', 'L-shaped'],
			['wait', 700],
			['pick', 'Island'],
			['wait', 900],
			['pick', 'Navy'],
			['pick', 'Marble'],
			['wait', 800],
			// Fronts and handles per cabinet: Larder, Sink, Prep, then the island's Pans.
			['tab', 'Cabinets'],
			['dropdown', 6, 'Glazed door'],
			['dropdown', 1, 'Bar'],
			['dropdown', 3, 1],
			['dropdown', 10, 'Open shelves'],
			['wait', 700],
			['orbit', -70, -6],
			['tab', 'Order'],
			['wait', 1800],
			['night'],
			['orbit', 60, 0]
		]
	},
	'shelving-unit': {
		zoom: 2,
		preview: [
			['slide', 'Width (mm)', 0.84],
			['choose', 'Bays', 2],
			['slide', 'Height (mm)', 0.52],
			['choose', 'Shelves', 1],
			['choose', 'Doors', 'Alternate bays'],
			['wait', 600],
			['scroll', 320],
			['choose', 'Wood', 1],
			['wait', 500],
			['orbit', -120, -8],
			['orbit', 70, 4]
		]
	},
	// The drawn inputs themselves are picked in the Rhino panel or drawn in the Selva app; in the
	// browser the form only sizes what was drawn.
	'garden-sketch': {
		reset: [['orbit', 300, -24]],
		preview: [
			['slide', 'Wall height (mm)', 0.3],
			['slide', 'Wall thickness (mm)', 0.7],
			['slide', 'Path width (mm)', 0.78],
			['scroll', 260],
			['slide', 'Shrub size (mm)', 0.85],
			['orbit', -90, 6]
		]
	}
};
