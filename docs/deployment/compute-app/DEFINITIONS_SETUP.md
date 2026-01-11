# Definitions Configuration

Configure Grasshopper definitions for the Selva compute application.

## Setup

1. Set environment variable:

   ```bash
   GH_DEFINITIONS_PATH=./definitions
   ```

2. Create `definitions-config.json` in your definitions folder:
   ```json
   {
   	"definitions": {
   		"my_solver": {
   			"displayName": "My Solver",
   			"description": "Brief description",
   			"coverImage": "https://example.com/image.jpg",
   			"tags": ["solver", "optimization"]
   		}
   	}
   }
   ```

## Fields

| Field         | Required | Notes                              |
| ------------- | -------- | ---------------------------------- |
| `displayName` | Yes      | User-friendly name shown in UI     |
| `description` | No       | Short description (2-line preview) |
| `coverImage`  | No       | URL or base64 data URL             |
| `tags`        | No       | Array of tags (up to 2 displayed)  |
| `category`    | No       | Not currently used                 |

## Behavior

- **Multiple definitions**: Shows selector at `/`
- **Single definition**: Auto-redirects to `/app`
- **Default**: First definition sorted alphabetically by displayName
- **Override**: Use `?gh=filename` URL parameter

## Example

```
./definitions/
├── definitions-config.json
├── solver_01.gh
└── parametric_form.gh
```

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

## Troubleshooting

| Issue                              | Solution                                                         |
| ---------------------------------- | ---------------------------------------------------------------- |
| "No definitions-config.json found" | Create the file at `GH_DEFINITIONS_PATH/definitions-config.json` |
| "Invalid config format"            | Ensure top-level `definitions` object exists                     |
| Definition not loading             | Verify filename in config matches `.gh` file (without extension) |
