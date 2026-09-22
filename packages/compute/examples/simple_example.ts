import {
	GrasshopperClient,
	type GrasshopperComputeConfig,
	TreeBuilder,
	GrasshopperResponseProcessor
} from '../src/grasshopper';

/**
 * Basic GrasshopperClient workflow: connect, inspect a definition's IO, build
 * inputs, solve, process results, dispose.
 *
 * Prerequisites:
 * - An active Rhino Compute instance running (default: http://localhost:5000)
 * - Live Server for VSCode running to serve the Grasshopper definition file (http://127.0.0.1:5500)
 * - A Grasshopper definition file (.gh)
 * - (Optional) An API key if your server requires authentication
 *
 * How to run:
 * npx tsx examples/simple_example.ts
 *
 * Troubleshooting:
 * - If connection fails, ensure Rhino Compute is running on http://localhost:5000
 * - If file not found, ensure Live Server is running and serving from project root
 * - Enable debug mode by setting debug: true in the config for detailed logging
 */
async function main() {
	// Configuration
	const DEFINITION_FILE = 'http://127.0.0.1:5500/examples/files/simple_api_test.gh';
	const COMPUTE_SERVER = 'http://localhost:5000';
	// const API_KEY = 'your-api-key'; // Replace with your actual API key if needed

	const config = {
		serverUrl: COMPUTE_SERVER,
		// apiKey: API_KEY,
		debug: false // Set to true for detailed logging
	} as GrasshopperComputeConfig;

	let client: GrasshopperClient | null = null;

	try {
		console.error('Creating GrasshopperClient...');
		try {
			client = await GrasshopperClient.create(config);
			console.error('✓ Client created successfully');
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(`✗ Failed to create client: ${message}`);
			console.error('  Make sure Rhino Compute is running on', COMPUTE_SERVER);
			throw error;
		}

		console.error('Fetching definition metadata...');
		let io;
		try {
			io = await client.getIO(DEFINITION_FILE);
			console.error(`✓ Found ${io.inputs.length} inputs and ${io.outputs.length} outputs`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(`✗ Failed to fetch definition: ${message}`);
			console.error('  Make sure the file exists at:', DEFINITION_FILE);
			throw error;
		}

		console.error('Building input tree...');
		const inputTree = TreeBuilder.fromInputParams(io.inputs);

		if (io.inputs.length > 0) {
			console.error('Available inputs:', io.inputs.map((input) => input.name).join(', '));
		}

		const inputToModify = 'number_input_2';
		const inputExists = io.inputs.some((input) => input.name === inputToModify);
		if (inputExists) {
			TreeBuilder.replaceTreeValue(inputTree, inputToModify, 30);
			console.error(`✓ Updated ${inputToModify} to 30`);
		} else {
			console.error(`⚠ Input "${inputToModify}" not found in definition`);
		}

		console.error('Running computation...');
		let result;
		try {
			result = await client.solve(DEFINITION_FILE, inputTree);
			console.error('✓ Computation completed successfully');
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(`✗ Computation failed: ${message}`);
			throw error;
		}

		console.error('Processing results...');
		const processor = new GrasshopperResponseProcessor(result);
		const { values } = processor.getValues();
		console.error('✓ Results processed');

		if (values && Object.keys(values).length > 0) {
			console.error('Output values:');
			Object.entries(values).forEach(([key, value]) => {
				console.error(`  ${key}:`, value);
			});
		} else {
			console.error('No output values returned');
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error('\n✗ Example failed:', message);
		process.exit(1);
	} finally {
		if (client) {
			try {
				await client.dispose();
				console.error('✓ Client disposed');
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.error('⚠ Error disposing client:', message);
			}
		}
	}
}

main();
