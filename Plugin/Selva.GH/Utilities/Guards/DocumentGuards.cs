using Grasshopper.Kernel;
using Selva.Schema.Models;

namespace Selva.GH.Utilities.Guards;

public static class DocumentGuards
{
    public static bool IsValid(GH_Document document, out string error)
    {
        if (document == null)
        {
            error = "Could not access Grasshopper document";
            return false;
        }

        error = null;
        return true;
    }

    public static bool HasSchema(UISchema schema, out string error)
    {
        if (schema == null)
        {
            error = "No schema available";
            return false;
        }

        error = null;
        return true;
    }

    public static bool DocumentAndSchemaValid(GH_Document document, UISchema schema, out string error)
    {
        if (!IsValid(document, out error))
        {
            return false;
        }

        if (!HasSchema(schema, out error))
        {
            return false;
        }

        error = null;
        return true;
    }
}
