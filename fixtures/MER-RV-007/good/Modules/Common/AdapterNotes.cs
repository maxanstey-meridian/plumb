namespace App.Modules.Common;

// RivetActionResult is Rivet's adapter output; a comment naming it is not a bridge.
public static class AdapterNotes
{
    /* (RivetActionResult)result.ToActionResult() */
    public const string Name = "RivetActionResult";
    public static string Describe(RivetResult result) => $"not a RivetActionResult: {result}";
}
