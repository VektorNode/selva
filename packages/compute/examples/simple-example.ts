import { readFile } from 'node:fs/promises';
import {
	GrasshopperClient,
	type GrasshopperComputeConfig,
	TreeBuilder,
	GrasshopperResponseProcessor
} from '../src/grasshopper';

/**
 * Prerequisites: a Rhino Compute instance (default http://localhost:6500), and an API key if it
 * requires one.
 *
 * Run: npx tsx examples/simple-example.ts
 */
async function main() {
	// Configuration
	const DEFINITION_FILE = new URL('./data/simple-api-test.gh', import.meta.url);
	const COMPUTE_SERVER = 'http://localhost:6500';

	const config: GrasshopperComputeConfig = {
		serverUrl: COMPUTE_SERVER,
		apiKey: process.env.COMPUTE_API_KEY,
		debug: false // true logs each request
	};

	let client: GrasshopperClient | null = null;

	try {
		const definition = new Uint8Array(await readFile(DEFINITION_FILE));

		// Step 1: Create and initialize the client
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

		// Step 2: Get definition inputs and outputs
		console.error('Fetching definition metadata...');
		let io;
		try {
			io = await client.getIO(definition);
			console.error(`✓ Found ${io.inputs.length} inputs and ${io.outputs.length} outputs`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(`✗ Failed to fetch definition: ${message}`);
			throw error;
		}

		// Step 3: Build input data tree from definition parameters
		console.error('Building input tree...');
		let inputTree = TreeBuilder.fromInputParams(io.inputs);

		// Log available inputs
		if (io.inputs.length > 0) {
			console.error('Available inputs:', io.inputs.map((input) => input.name).join(', '));
		}

		// Trees are keyed by nickname, and replaceTreeValue returns a new array.
		const inputToModify = 'number_input_2';
		const inputExists = io.inputs.some((input) => input.nickname === inputToModify);
		if (inputExists) {
			inputTree = TreeBuilder.replaceTreeValue(inputTree, inputToModify, 30);
			console.error(`✓ Updated ${inputToModify} to 30`);
		} else {
			console.error(`⚠ Input "${inputToModify}" not found in definition`);
		}

		// Step 4: Run the computation
		console.error('Running computation...');
		let result;
		try {
			result = await client.solve(definition, inputTree);
			console.error('✓ Computation completed successfully');
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(`✗ Computation failed: ${message}`);
			throw error;
		}

		// Step 5: Process and display results
		console.error('Processing results...');
		const processor = new GrasshopperResponseProcessor(result);
		const { values } = processor.getValues();
		console.error('✓ Results processed');

		// Display results in a structured format
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
		process.exitCode = 1;
	} finally {
		// Step 6: Clean up resources
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
