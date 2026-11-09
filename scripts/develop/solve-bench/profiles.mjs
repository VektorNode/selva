// What each definition's inputs may be set to. `base` is where every user starts, `perUser`
// separates users (an affinity run needs documents that differ, so a cold one pays), `inputs`
// gives the ranges a scenario picks from, `vary` is the input a turn changes, `classes` the
// inputs the `inputs` scenario walks, and `sweep` the input the `sweep` scenario steps.
//
// A JSON file of the same shape works too: `--profile path/to/profile.json`.

export const PROFILES = {
	bench: {
		file: 'dev/grasshopper/bench-solve-transport.gh',
		base: {
			'Upstream work': 2,
			Shape: 0.5,
			'Mesh size': 10,
			Branches: 8,
			'Shape scope': 1,
			'Context size': 10,
			Colour: '#8a6d4b',
			Files: false
		},
		// Upstream work feeds everything, so documents that differ in it make every cold solve pay it.
		perUser: [{ 'Upstream work': 2 }, { 'Upstream work': 2.01 }, { 'Upstream work': 2.02 }],
		inputs: {
			'Upstream work': { min: 0, max: 10, decimals: 2 },
			Shape: { min: 0, max: 1 },
			'Mesh size': { min: 1, max: 60, integer: true },
			Branches: { min: 1, max: 32, integer: true },
			'Shape scope': { min: 1, max: 32, integer: true },
			'Context size': { min: 0, max: 50, integer: true },
			Colour: { color: true },
			Files: { boolean: true }
		},
		vary: 'Shape',
		classes: ['Colour', 'Shape', 'Files', 'Context size', 'Branches'],
		sweep: { input: 'Mesh size', values: [1, 5, 10, 20, 40, 60], change: 'Colour' }
	},

	facade: {
		file: 'examples/definitions/perforated-facade.gh',
		base: {
			Columns: 3,
			Rows: 2,
			'Panel width': 900,
			'Panel height': 2000,
			'Hole pitch': 80,
			'Attractor X': 20,
			'Attractor Y': 30,
			'Smallest hole': 5,
			'Largest hole': 70
		},
		perUser: [
			{},
			{
				Columns: 7,
				Rows: 3,
				'Panel width': 1400,
				'Panel height': 3200,
				'Hole pitch': 140,
				'Attractor X': 80,
				'Attractor Y': 70,
				'Smallest hole': 30,
				'Largest hole': 90
			},
			{
				Columns: 5,
				Rows: 4,
				'Panel width': 1100,
				'Panel height': 2600,
				'Hole pitch': 110,
				'Attractor X': 50,
				'Attractor Y': 50,
				'Smallest hole': 15,
				'Largest hole': 80
			}
		],
		inputs: {
			Columns: { min: 2, max: 8, integer: true },
			'Attractor X': { min: 0, max: 100, integer: true },
			'Largest hole': { min: 41, max: 95, integer: true },
			'Coating colour': { color: true },
			Backlit: { boolean: true }
		},
		vary: 'Largest hole',
		classes: ['Coating colour', 'Largest hole', 'Columns', 'Backlit']
	},

	gridshell: {
		file: 'examples/definitions/timber-gridshell-pavilion.gh',
		base: { Span: 18, Depth: 13, Height: 5.5, Openings: 0.55, Waves: 2, 'Lamella spacing': 0.9 },
		perUser: [
			{},
			{ Span: 26, Depth: 20, Height: 8, Waves: 3 },
			{ Span: 12, Depth: 9, Height: 4, Waves: 1 }
		],
		inputs: {
			Openings: { min: 0, max: 0.85, decimals: 3 },
			Span: { min: 10, max: 30, decimals: 2 },
			'Lamella spacing': { min: 0.5, max: 1.6, decimals: 3 },
			'Edge beam colour': { color: true },
			Timber: { values: ['Larch', 'Walnut', 'Charred'] },
			'Glass roof': { boolean: true }
		},
		vary: 'Openings',
		classes: ['Edge beam colour', 'Timber', 'Glass roof', 'Openings', 'Span']
	}
};
