# ValueList Compute Fix

## Problem
When compute returns ValueList values, it was sending the **expression/value** (e.g., `"0"`) instead of the **name/key** (e.g., `"Sphere"`).

## Solution
Updated `GH_ValueListDataGoo.cs` to properly handle name/expression mapping:

### Key Changes

1. **Added `SerializeValue()` method**
   - Returns the name (key) for serialization instead of the expression value
   - Ensures UI receives human-readable values like "Sphere" not "0"

2. **Updated `ToString()` method**
   - Now returns `SelectedName` instead of `Value`
   - Makes outputs more readable

3. **Updated `CastTo<GH_String>()` method**
   - Returns the name when casting to string
   - Aligns with Grasshopper UI conventions

4. **Enhanced `FromString()` in Proxy**
   - Accepts names and looks up the corresponding expression
   - Allows bidirectional conversion between names and expressions

5. **Added `FromComputeValue()` static method**
   - New method specifically for handling compute responses
   - Intelligently maps incoming values to items by name or expression

### Usage in Compute Response Handling

When processing a compute response with ValueList inputs, use:

```csharp
case "ValueList":
{
    var stringList = new List<string>();
    foreach (KeyValuePair<string, List<ResthopperObject>> entree in tree)
    {
        for (int i = 0; i < entree.Value.Count; i++)
        {
            ResthopperObject restobj = entree.Value[i];
            string data = restobj.Data.Trim('"');
            stringList.Add(data);
        }
    }

    // Get the contextual parameter
    var contextualParam = inputGroup.Param as GetValueListParameter;
    if (contextualParam != null)
    {
        // Use FromComputeValue to properly handle name/expression mapping
        var valueListItems = new List<GH_ValueListDataGoo>();
        foreach (var value in stringList)
        {
            var items = contextualParam.ListItems
                .Select(x => (x.Name, x.Expression))
                .ToList();

            var goo = GH_ValueListDataGoo.FromComputeValue(value, items);
            valueListItems.Add(goo);
        }

        // Assign the converted values
        contextualParameter.GetType()
            .GetMethod("AssignContextualData")?
            .Invoke(contextualParameter, new object[] { valueListItems });
    }

    inputGroup.Param.VolatileData.Clear();
    inputGroup.Param.ExpireSolution(false);
}
```

### Data Flow

**Before Fix:**
```
Compute Response: "0" (expression)
  ↓
Sent to Grasshopper as-is
  ↓
UI shows "0" (confusing)
```

**After Fix:**
```
Compute Response: "0" (expression)
  ↓
FromComputeValue() maps to name
  ↓
Grasshopper receives "Sphere" (name/key)
  ↓
UI shows "Sphere" (correct!)
```

## Files Modified
- `Plugin/Features/ComputeIO/Components/GH_ValueListData.cs`

## Testing
Test with ValueList parameters in compute workflows to verify:
1. Names (keys) are sent to compute, not expressions
2. Responses from compute properly map back to names
3. UI displays correct readable values
