---
'@selva/schemas': minor
'@selva/shared': minor
'selva-core': minor
---

Add group-level visibility conditions for conditional group show/hide

**New Capabilities:**

- **GroupVisibilityCondition** schema type: apply visibility rules to entire groups
  - Supports same rule evaluation as item conditions (AND/OR logic, all operators)
  - Actions: `show` (default), `hide`
  - No `defaultValue` support (defaults are applied at item level)
  - Individual item rules remain independent from group visibility

- **Builder UI**: Group visibility editor in EditableGroup component
  - Expandable visibility rules section in group header
  - Same intuitive rule builder as item conditions
  - Shows rule count when rules exist

- **Preview**: Runtime group visibility evaluation in TabLayout
  - Groups are completely hidden when visibility condition hides them
  - Item-level visibility and defaults still execute independently
  - Maintains consistency with item-level visibility evaluation

**Example Usage:**

```json
{
	"visibilityCondition": {
		"mode": "all",
		"action": "hide",
		"rules": [
			{
				"paramId": "mode-id",
				"operator": "equals",
				"value": "basic"
			}
		]
	}
}
```

**Benefits:**

- Organize UI into collapsible sections with conditional visibility
- Hide entire "Advanced Options" groups based on user mode selection
- Cleaner schemas without repeated visibility rules for multiple items
- Individual items can still have their own conditions and default values
