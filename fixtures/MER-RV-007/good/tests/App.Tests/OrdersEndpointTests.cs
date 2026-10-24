namespace App.Tests;

// A test may read the adapter's output to assert on the status it produced.
public sealed class OrdersEndpointTests
{
    [Fact]
    public void ListIsOk() =>
        Assert.Equal(200, ((RivetActionResult)OrdersContract.List.Success(new OrderPage()).ToActionResult()).StatusCode);
}
