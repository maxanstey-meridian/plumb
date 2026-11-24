using App.Stubs;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace App.Modules.Areas;

[Authorize]
public sealed class AreasController(RenameAreaUseCase renameArea) : ControllerBase
{
    [Authorize(Policy = "Areas")]
    public IActionResult Rename()
    {
        renameArea.Execute();
        return Ok();
    }
}
