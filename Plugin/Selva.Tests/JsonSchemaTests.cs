using Newtonsoft.Json;
using Selva.Core.Models;
using Selva.Core.Services.Validation;

namespace Selva.Tests;

public class JsonSchemaTests
{
    private readonly SchemaValidator _validator;

    public JsonSchemaTests()
    {
        _validator = new SchemaValidator();
    }

    [Theory]
    [InlineData("valid_schema.json")]
    public void Validate_JsonSchema_ReturnsSuccess(string fileName)
    {
        var filePath = Path.Combine("TestFiles", fileName);
        var json = File.ReadAllText(filePath);
        var schema = JsonConvert.DeserializeObject<UISchema>(json);

        var result = _validator.Validate(schema);

        Assert.True(result.IsValid);
    }
}
