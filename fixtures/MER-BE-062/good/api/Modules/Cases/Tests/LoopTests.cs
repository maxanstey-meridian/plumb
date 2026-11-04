using App.Modules.Forms.Contracts;
using App.Modules.Records.Contracts;

namespace App.Modules.Cases.Tests;

// Test code by its folder: it may use every module.
public sealed class LoopTests
{
    public FormSummary? Form { get; set; }
    public RecordSummary? Record { get; set; }
}
