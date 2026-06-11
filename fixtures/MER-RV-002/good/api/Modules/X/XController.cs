public sealed class XController : ControllerBase
{
    [HttpPost(XContract.CreateRoute)]
    public IActionResult Create() => Ok();
}
