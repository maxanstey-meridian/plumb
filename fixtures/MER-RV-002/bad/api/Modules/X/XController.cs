public sealed class XController : ControllerBase
{
    [HttpPost("api/x")]
    public IActionResult Create() => Ok();
}
