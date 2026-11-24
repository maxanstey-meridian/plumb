using App.Modules.Areas.Application;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace App.Modules.Areas;

[Authorize(Policy = "Areas")]
public sealed class AreasController(RenameAreaUseCase renameArea) : ControllerBase
{
    public RenameAreaOutcome Rename(Guid areaId) => renameArea.Execute(areaId);
}
