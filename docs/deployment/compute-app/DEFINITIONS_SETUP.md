# Definitions Configuration

Store your Grasshopper definitions in a local directory with a metadata config file.

## Setup

Set `GH_DEFINITIONS_PATH` to a folder containing your `.gh` files and a `definitions-config.json`:

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

## Metadata Fields

| Field         | Required | Notes                             |
| ------------- | -------- | --------------------------------- |
| `displayName` | Yes      | User-friendly name shown in UI    |
| `description` | No       | Short description (preview text)  |
| `coverImage`  | No       | URL or base64 data URL            |
| `tags`        | No       | Array of tags (up to 2 displayed) |

## Behavior

- **Multiple definitions** — shows selector at `/`
- **Single definition** — auto-redirects to `/app`
- **Override** — use `?gh=filename` URL parameter

## Troubleshooting

| Issue | Solution |
| --- | --- |
| "No definitions found" | Verify `GH_DEFINITIONS_PATH` exists and points to the right folder |
| "Invalid config format" | Ensure `definitions-config.json` has a top-level `definitions` object |
| Definition not loading | Filename in config must match the `.gh` file name (without extension) |
| "COMPUTE_SERVER_URL is required" | Set `COMPUTE_SERVER_URL` environment variable |
