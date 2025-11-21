<script lang="ts">
	/**
	 * Example component demonstrating the theming and customization features
	 * of rhino-compute-ui with Svelte 5
	 */
	import InputHandler from '../InputHandler.svelte';
	import NumberParam from '../components/input-params/NumberParam.svelte';
	import type { InputParam } from 'rhino-compute-core/grasshopper';
	import type { ThemePreset, InputVariant, ComponentSize } from '../theme/types.js';

	// Example Grasshopper inputs (you would get these from your definition)
	let exampleInputs: InputParam[] = $state([
		{
			name: 'Width',
			paramType: 'Number',
			description: 'Width of the element',
			default: 10,
			minimum: 0,
			maximum: 100,
			groupName: 'Dimensions'
		},
		{
			name: 'Height',
			paramType: 'Number',
			description: 'Height of the element',
			default: 20,
			minimum: 0,
			maximum: 100,
			groupName: 'Dimensions'
		},
		{
			name: 'Name',
			paramType: 'Text',
			description: 'Element name',
			default: 'MyElement',
			groupName: 'Properties'
		},
		{
			name: 'Visible',
			paramType: 'Boolean',
			description: 'Show or hide element',
			default: true,
			groupName: 'Properties'
		}
	] as any);

	// Theme controls
	let selectedPreset: ThemePreset = $state('default');
	let selectedVariant: InputVariant = $state('default');
	let selectedSize: ComponentSize = $state('md');
	let showSliders = $state(false);

	// Custom color controls
	let customPrimaryColor = $state('#0ea5e9');
	let customAccentColor = $state('#06b6d4');
	let useCustomColors = $state(false);

	// Available options
	const presets: ThemePreset[] = ['default', 'minimal', 'modern', 'classic', 'dark'];
	const variants: InputVariant[] = ['default', 'outlined', 'filled', 'minimal'];
	const sizes: ComponentSize[] = ['sm', 'md', 'lg'];

	let customThemeString = $state<string>('');

	// Computed custom theme
	const customTheme = $derived(
		useCustomColors
			? {
					colors: {
						primary: customPrimaryColor,
						borderFocus: customPrimaryColor,
						accent: customAccentColor
					}
				}
			: undefined
	);

	function handleChange(dataTrees: any[]) {
		console.log('Values changed:', dataTrees);
	}
</script>

<div class="example-container" class:dark={selectedPreset === 'dark'}>
	<div class="controls">
		<h3>Theme Controls</h3>

		<div class="control-group">
			<label for="preset">Theme Preset:</label>
			<select id="preset" bind:value={selectedPreset}>
				{#each presets as preset}
					<option value={preset}>{preset}</option>
				{/each}
			</select>
		</div>

		<div class="control-group">
			<label for="variant">Input Variant:</label>
			<select id="variant" bind:value={selectedVariant}>
				{#each variants as variant}
					<option value={variant}>{variant}</option>
				{/each}
			</select>
		</div>

		<div class="control-group">
			<label for="size">Component Size:</label>
			<select id="size" bind:value={selectedSize}>
				{#each sizes as size}
					<option value={size}>{size}</option>
				{/each}
			</select>
		</div>

		<div class="control-group">
			<label>
				<input type="checkbox" bind:checked={showSliders} />
				Show Sliders
			</label>
		</div>

		<div class="control-group">
			<label>
				<input type="checkbox" bind:checked={useCustomColors} />
				Custom Colors
			</label>
		</div>

		{#if useCustomColors}
			<div class="control-group">
				<label for="primaryColor">Primary Color:</label>
				<div class="color-input-wrapper">
					<input
						type="color"
						id="primaryColor"
						bind:value={customPrimaryColor}
						class="color-picker"
					/>
					<input type="text" bind:value={customPrimaryColor} class="color-text" />
				</div>
			</div>

			<div class="control-group">
				<label for="accentColor">Accent Color:</label>
				<div class="color-input-wrapper">
					<input
						type="color"
						id="accentColor"
						bind:value={customAccentColor}
						class="color-picker"
					/>
					<input type="text" bind:value={customAccentColor} class="color-text" />
				</div>
			</div>
		{/if}
	</div>

	<div class="preview">
		<h3>Preview</h3>
		<div class="theme-indicator" style="--theme-color: var(--rh-color-primary, #000)">
			<span>Current primary color:</span>
			<div class="color-box" style="background-color: var(--rh-color-primary, #ccc)"></div>
		</div>
		<InputHandler
			input={exampleInputs}
			onChange={handleChange}
			headerText="Example Parameters"
			displayOptions={{
				preset: selectedPreset,
				variant: selectedVariant,
				size: selectedSize,
				showSliders,
				showRangeIndicator: true,
				accordionSeparated: true,
				theme: customTheme
			}}
			autoUpdate={true}
		/>
	</div>

	<div class="code-example">
		<h3>Code</h3>
		<pre><code
				>{`<InputHandler
  input={exampleInputs}
  onChange={handleChange}
  displayOptions={{
    preset: '${selectedPreset}',
    variant: '${selectedVariant}',
    size: '${selectedSize}',
    showSliders: ${showSliders}
  }}
/>`}</code
			></pre>
	</div>

	<div class="custom-example">
		<h3>Custom Input Component Example</h3>
		<p>Here's a number input with a custom range slider implementation:</p>

		{#snippet customNumberExample()}
			{@const widthInput = exampleInputs.find((i) => i.name === 'Width')}
			{#if widthInput && widthInput.paramType === 'Number' && widthInput.default != null}
				<NumberParam input={widthInput} bind:value={widthInput.default}>
					{#snippet customInput({ value, onUpdate, input })}
						<div class="custom-slider">
							<div class="slider-header">
								<span class="slider-label">{input.name}</span>
								<span class="slider-value">{value}</span>
							</div>
							<input
								type="range"
								min={input.minimum ?? 0}
								max={input.maximum ?? 100}
								{value}
								oninput={(e) => onUpdate(parseFloat(e.currentTarget.value))}
								class="gradient-slider"
							/>
							<div class="slider-footer">
								<span>{input.minimum ?? 0}</span>
								<span>{input.maximum ?? 100}</span>
							</div>
						</div>
					{/snippet}
				</NumberParam>
			{/if}
		{/snippet}

		{@render customNumberExample()}
	</div>
</div>

<style>
	.example-container {
		display: grid;
		grid-template-columns: 250px 1fr;
		grid-template-rows: auto auto;
		gap: 2rem;
		padding: 2rem;
		background: #f9fafb;
		min-height: 100vh;
	}

	.example-container.dark {
		background: #0f172a;
		color: #f8fafc;
	}

	.controls {
		grid-column: 1;
		grid-row: 1 / -1;
		background: white;
		padding: 1.5rem;
		border-radius: 0.5rem;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
		height: fit-content;
		position: sticky;
		top: 2rem;
	}

	.example-container.dark .controls {
		background: #1e293b;
		color: #f8fafc;
	}

	.controls h3 {
		margin: 0 0 1.5rem;
		font-size: 1.125rem;
		font-weight: 600;
	}

	.control-group {
		margin-bottom: 1.5rem;
	}

	.control-group label {
		display: block;
		font-size: 0.875rem;
		font-weight: 500;
		margin-bottom: 0.5rem;
		color: #374151;
	}

	.example-container.dark .control-group label {
		color: #cbd5e1;
	}

	.control-group select {
		width: 100%;
		padding: 0.5rem;
		border: 1px solid #d1d5db;
		border-radius: 0.375rem;
		background: white;
		font-size: 0.875rem;
	}

	.example-container.dark .control-group select {
		background: #334155;
		border-color: #475569;
		color: #f8fafc;
	}

	.control-group input[type='checkbox'] {
		margin-right: 0.5rem;
	}

	.color-input-wrapper {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}

	.color-picker {
		width: 3rem;
		height: 2.5rem;
		border: 1px solid #d1d5db;
		border-radius: 0.375rem;
		cursor: pointer;
	}

	.color-text {
		flex: 1;
		padding: 0.5rem;
		border: 1px solid #d1d5db;
		border-radius: 0.375rem;
		font-family: monospace;
		font-size: 0.8125rem;
	}

	.example-container.dark .color-picker,
	.example-container.dark .color-text {
		background: #334155;
		border-color: #475569;
		color: #f8fafc;
	}

	.preview {
		grid-column: 2;
		grid-row: 1;
		background: white;
		padding: 2rem;
		border-radius: 0.5rem;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
	}

	.example-container.dark .preview {
		background: #1e293b;
	}

	.preview h3 {
		margin: 0 0 1.5rem;
		font-size: 1.25rem;
		font-weight: 600;
	}

	.theme-indicator {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 1rem;
		padding: 0.75rem;
		background: #f3f4f6;
		border-radius: 0.375rem;
		font-size: 0.875rem;
	}

	.example-container.dark .theme-indicator {
		background: #0f172a;
	}

	.color-box {
		width: 2rem;
		height: 2rem;
		border-radius: 0.375rem;
		border: 2px solid #000;
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
	}

	.example-container.dark .color-box {
		border-color: #fff;
	}

	.code-example,
	.custom-example {
		grid-column: 2;
		background: white;
		padding: 2rem;
		border-radius: 0.5rem;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
	}

	.example-container.dark .code-example,
	.example-container.dark .custom-example {
		background: #1e293b;
	}

	.code-example h3,
	.custom-example h3 {
		margin: 0 0 1rem;
		font-size: 1.125rem;
		font-weight: 600;
	}

	.code-example pre {
		background: #f3f4f6;
		padding: 1rem;
		border-radius: 0.375rem;
		overflow-x: auto;
		font-size: 0.875rem;
		line-height: 1.5;
	}

	.example-container.dark .code-example pre {
		background: #0f172a;
	}

	.code-example code {
		font-family: 'Monaco', 'Menlo', monospace;
	}

	.custom-example p {
		margin: 0 0 1.5rem;
		color: #6b7280;
	}

	.example-container.dark .custom-example p {
		color: #94a3b8;
	}

	.custom-slider {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 1rem;
		background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
		border-radius: 0.75rem;
		color: white;
	}

	.slider-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.slider-label {
		font-weight: 600;
		font-size: 0.875rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.slider-value {
		font-size: 1.5rem;
		font-weight: 700;
	}

	.gradient-slider {
		width: 100%;
		height: 8px;
		border-radius: 4px;
		background: rgba(255, 255, 255, 0.3);
		appearance: none;
		cursor: pointer;
	}

	.gradient-slider::-webkit-slider-thumb {
		appearance: none;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background: white;
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
		cursor: pointer;
	}

	.gradient-slider::-moz-range-thumb {
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background: white;
		border: none;
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
		cursor: pointer;
	}

	.slider-footer {
		display: flex;
		justify-content: space-between;
		font-size: 0.75rem;
		opacity: 0.8;
	}
</style>
