using App.Data;
using Microsoft.AspNetCore.Mvc;

namespace App.Modules.Forms;

public sealed class FormsController(AppDbContext db) : ControllerBase
{
    public bool Ready() => db is not null;
}
