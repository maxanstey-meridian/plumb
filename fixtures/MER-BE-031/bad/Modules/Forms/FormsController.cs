using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace App.Modules.Forms;

public sealed class FormsController : ControllerBase
{
    public Task<List<string>> Titles(IQueryable<string> titles, CancellationToken cancellationToken) => titles.ToListAsync(cancellationToken);
}
