public sealed class XController : ControllerBase
{
    [HttpPost(XContract.CreateRoute)]
    public IActionResult Create() => Ok();

    private const string CompilerFixture = """
        [HttpGet("/fixture")]
        """;
}
