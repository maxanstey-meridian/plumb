namespace App.Common.Ports;
// The port's own model shares the Forms domain type's name.
public sealed record FormSnapshot(string Id, string Title);
