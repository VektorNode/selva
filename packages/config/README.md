# @selva/config

Shared configuration for the Selva monorepo. This package centralizes build, linting, and other tooling configurations to reduce duplication and ensure consistency across packages.

## ESLint Configuration

This package provides a shared ESLint 9 (Flat Config) setup.

### Usage

In your package's `eslint.config.js`:

```javascript
import { createConfig } from '@selva/config/eslint';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default createConfig(__dirname);
```

The `createConfig` factory automatically sets up:

- `tsconfigRootDir` for proper TypeScript parsing
- Svelte parsing for `.svelte` files
- Common rules and ignores

## Vite Configuration

Shared Vite configuration for SvelteKit and library builds.

### Usage

In your package's `vite.config.ts`:

```typescript
import { createConfig } from '@selva/config/vite';

export default createConfig({
  // Package-specific overrides
  plugins: [
    // ...
  ],
});
```

## Prettier Configuration

Shared Prettier configuration with Svelte and Tailwind CSS support.

### Usage

In your package's `prettier.config.js`:

```javascript
import sharedConfig from '@selva/config/prettier';

export default sharedConfig;
```

Or with overrides:

```javascript
import sharedConfig from '@selva/config/prettier';

export default {
  ...sharedConfig,
  // Package-specific overrides
  tailwindStylesheet: './src/custom/path.css',
};
```

The shared config uses:
- Tabs for indentation
- Single quotes
- No trailing commas
- 100 character line width
- Includes `prettier-plugin-svelte` and `prettier-plugin-tailwindcss`

## TypeScript

TypeScript configurations are managed via the root `tsconfig.base.json` and its variants (`tsconfig.lib.json`). Packages extend these directly.
