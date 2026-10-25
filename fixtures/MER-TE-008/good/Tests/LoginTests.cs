namespace App.Tests
{
    public sealed class LoginTests
    {
        private const string Example = """
            }
            public sealed class FakeFromDocumentation { }
            {
            """;
        private sealed class FakeClock { }
    }

    public sealed class InlineObjectOptionalityTests { }

    // A file-local double can't be reused.
    file sealed class FakeLocal { }
}
