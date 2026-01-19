---
'@selva/schemas': minor
'@selva/shared': minor
'selva-core': minor
---

Add `action` and `defaultValue` to VisibilityCondition for enhanced parameter state management

**New Capabilities:**

- **action** enum: control parameter visibility state (`show`, `hide`, `disable`)
  - `show` (default): parameter is visible and enabled
  - `hide`: parameter is removed from view
  - `disable`: parameter is visible but greyed out and non-interactive

- **defaultValue**: set parameter values when condition is met, eliminating repetition in conditional logic

**Example Usage:**

```json
{
	"visibilityCondition": {
		"mode": "all",
		"action": "disable",
		"defaultValue": 2,
		"rules": [
			{
				"paramId": "leg-type-id",
				"operator": "equals",
				"value": "square"
			}
		]
	}
}
```

**Benefits:**

- Zero repetition: single condition object handles visibility + default values
- DRY principle: no need to duplicate rules for multiple actions
- Backwards compatible: new fields are optional, existing schemas continue to work
- Extensible: action enum can support additional states in the future
