using System;
using System.Collections.Generic;
using Xunit;
using Selva.Core.Models;
using Selva.Core.Services;

namespace Selva.Tests
{
  public class SchemaValidatorTests
  {
    private readonly SchemaValidator _validator;

    public SchemaValidatorTests()
    {
      _validator = new SchemaValidator();
    }

    [Fact]
    public void Validate_NullSchema_ReturnsFailure()
    {
      var result = _validator.Validate(null);
      Assert.False(result.IsValid);
      Assert.Contains(result.Issues, i => i.Message == "Schema is null");
    }

    [Fact]
    public void Validate_ValidSchema_ReturnsSuccess()
    {
      var schema = new UISchema
      {
        Id = "test-schema",
        Name = "Test Schema",
        PluginVersion = "1.0.0",
        Inputs = new List<InputParamSchema>
                {
                    new InputParamSchema
                    {
                        Id = Guid.NewGuid(),
                        Nickname = "I1",
                        ParamType = "number"
                    }
                },
        Outputs = new List<AvailableOutput>(),
        Layout = new LayoutConfig
        {
          Tabs = new List<TabConfig>
                    {
                        new TabConfig { Id = "tab1", Label = "Tab 1" }
                    }
        }
      };

      var result = _validator.Validate(schema);
      Assert.True(result.IsValid);
      Assert.DoesNotContain(result.Issues, i => i.Severity == ValidationSeverity.Error);
    }
    [Fact]
    public void Validate_MissingRequiredFields_ReturnsErrors()
    {
      var schema = new UISchema(); // Empty schema

      var result = _validator.Validate(schema);
      Assert.False(result.IsValid);

      Assert.Contains(result.Issues, i => i.Message == "Schema ID is required");
      Assert.Contains(result.Issues, i => i.Message == "Schema name is required");
      Assert.Contains(result.Issues, i => i.Message == "Layout is null");
    }
  }
}
