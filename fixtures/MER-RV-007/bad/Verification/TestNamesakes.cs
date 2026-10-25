namespace App.Verification;

// Test code builds results freely, but a helper named like Rivet's adapter can still shadow it in a test.
public static class TestNamesakes
{
    public static IResult ToResult(this RivetResult result) => Results.Json(result);
}
