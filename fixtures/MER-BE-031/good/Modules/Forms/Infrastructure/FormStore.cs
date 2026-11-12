using Microsoft.EntityFrameworkCore;

namespace App.Modules.Forms.Infrastructure;

// An adapter imports persistence; only a controller is kept away from it.
public sealed class FormStore
{
    public Task<List<string>> Titles(IQueryable<string> titles, CancellationToken cancellationToken) => titles.ToListAsync(cancellationToken);
}
