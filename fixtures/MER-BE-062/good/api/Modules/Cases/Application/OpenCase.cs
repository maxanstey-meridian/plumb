using App.Infrastructure;
using App.Modules.Forms.Contracts;

namespace App.Modules.Cases.Application;

public sealed class OpenCase(FormSummary form)
{
    public PublicKey Key { get; } = PublicKey.Id;
}
