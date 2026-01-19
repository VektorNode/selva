# Definitions Configuration

Configure Grasshopper definitions for the Selva compute application. The system supports multiple definition sources: local filesystem, environment variables, or custom loaders.

## Configuration Modes

The app auto-detects the definition source based on environment variables (see [PREREQUISITES.md](./PREREQUISITES.md#3-environment-configuration)):

### 1. Filesystem Mode (Default)

Store definitions in a local directory with metadata config:

**Environment variables:**
- `GH_DEFINITIONS_PATH` - Path to definitions folder (default: `./definitions`)

**Required file:**
```
definitions/
├── definitions-config.json
├── solver_01.gh
└── parametric_form.gh
```

**definitions-config.json:**
```json
{
	"definitions": {
		"solver_01": {
			"displayName": "Advanced Solver",
			"description": "Complex optimization",
			"coverImage": "https://example.com/solver.jpg",
			"tags": ["optimization", "numerical"]
		},
		"parametric_form": {
			"displayName": "Parametric Generator",
			"description": "Parametric geometry",
			"tags": ["parametric", "geometry"]
		}
	}
}
```

### 2. Environment Variables Mode

For cloud/serverless deployments, define definitions as environment variables:

**Environment variables:**
- `DEFINITION_SOURCE=environment` - Explicitly use env var source
- `GH_DEF_*` - Each variable contains JSON with metadata and remote URL

**Example:**
```bash
GH_DEF_SOLVER='{"metadata":{"displayName":"Fast Solver","description":"Optimized solver"},"url":"https://storage.example.com/solver.gh"}'
GH_DEF_ANALYSIS='{"metadata":{"displayName":"Analysis Tool"},"url":"https://storage.example.com/analysis.gh"}'
```

### 3. Custom Loaders

Implement custom loaders (S3, databases, etc.) by extending `IDefinitionLoader`. See `packages/compute-app/src/lib/server/definitions/loaders/README.md` for details.

## Metadata Fields

| Field         | Required | Notes                              |
| ------------- | -------- | ---------------------------------- |
| `displayName` | Yes      | User-friendly name shown in UI     |
| `description` | No       | Short description (preview text)   |
| `coverImage`  | No       | URL or base64 data URL             |
| `tags`        | No       | Array of tags (up to 2 displayed)  |
| `category`    | No       | For future use                     |

## Behavior

- **Multiple definitions**: Shows selector at `/`
- **Single definition**: Auto-redirects to `/app`
- **Default**: First definition sorted alphabetically by displayName
- **Override**: Use `?gh=filename` URL parameter

## Troubleshooting

| Issue                              | Solution                                                         |
| ---------------------------------- | ---------------------------------------------------------------- |
| "No definitions found"             | Verify `GH_DEFINITIONS_PATH` exists or `GH_DEF_*` env vars are set |
| "Invalid config format"            | Ensure `definitions-config.json` has top-level `definitions` object |
| Definition not loading             | Verify filename in config matches `.gh`/`.ghx` file (without extension) |
| "COMPUTE_SERVER_URL is required"   | Set `COMPUTE_SERVER_URL` environment variable                     |
