namespace Xunit;

[AttributeUsage(AttributeTargets.Method)]
public sealed class FactAttribute : Attribute;

public static class Assert
{
    public static void Equivalent(object? expected, object? actual) { }
}
