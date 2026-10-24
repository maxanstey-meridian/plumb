namespace App.Verification;

// Test code may read the adapter's output and build a result to compare it with. Nothing in its folder or file
// name says so: its project's <IsTestProject> does.
public sealed class OrdersEndpointChecks
{
    [Fact]
    public void ListIsOk()
    {
        var adapted = (RivetActionResult)OrdersContract.List.Success(new OrderPage()).ToActionResult();
        Assert.Equivalent(new OkObjectResult(new OrderPage()).Value, adapted.Value);
    }
}
