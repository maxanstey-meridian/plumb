namespace App.Modules.Common;

// An extension on RivetResult that returns no HTTP result is not a transport bridge.
public static class RivetResultDescriptions
{
    public static string Describe(this RivetResult result) => result.ToString();

    public static Task<string> DescribeAsync(this RivetResult result) => Task.FromResult(result.ToString());
}
