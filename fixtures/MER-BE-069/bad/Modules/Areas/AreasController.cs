using Microsoft.AspNetCore.Mvc;

namespace App.Modules.Areas;

public sealed class AreasController : ControllerBase
{
    public IActionResult Rename()
    {
        if (!User.IsInRole("Admin"))
        {
            return Forbid();
        }

        return Ok();
    }
}
