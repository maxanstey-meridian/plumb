namespace App.Verification;

// Test code is exempt from the bridge check: a test helper may build its own result off RivetResult.
public static class TestBridge
{
    public static IResult AsJson(this RivetResult result) => Results.Json(result);
}
