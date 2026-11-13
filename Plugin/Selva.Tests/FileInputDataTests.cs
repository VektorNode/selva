using Selva.FileIO;
using Xunit;

namespace Selva.Tests;

/// <summary>
///     On Compute a solve request must not name a file by path: the server would open it with its
///     own rights for anyone who can solve.
/// </summary>
public class FileInputDataTests
{
    [Theory]
    [InlineData("path", @"C:\Windows\win.ini")]
    [InlineData("PATH", @"\attacker\share\a.png")]
    [InlineData(null, "/etc/passwd")]
    [InlineData("", "relative.3dm")]
    public void A_path_is_refused_as_a_request_input_on_Compute(string type, string file)
    {
        var data = new FileInputData { File = file, Type = type };

        Assert.NotNull(data.ProblemAsRequestInput(true));
    }

    [Theory]
    [InlineData("base64")]
    [InlineData("url")]
    [InlineData("URL")]
    public void Data_the_request_sends_and_URLs_are_accepted_on_Compute(string type)
    {
        var data = new FileInputData { File = "x", Type = type };

        Assert.Null(data.ProblemAsRequestInput(true));
    }

    [Fact]
    public void A_path_is_accepted_in_Rhino_where_the_user_picked_the_file()
    {
        Assert.Null(FileInputData.FromPath(@"C:\models\part.3dm").ProblemAsRequestInput(false));
    }
}
