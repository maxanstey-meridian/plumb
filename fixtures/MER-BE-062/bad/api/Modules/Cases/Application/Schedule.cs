using App.Common;

namespace App.Modules.Cases.Application;

public sealed class Schedule
{
    public Clock Clock { get; } = new();
}
