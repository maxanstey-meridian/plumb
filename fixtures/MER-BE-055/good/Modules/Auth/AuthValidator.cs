namespace App.Modules.Auth;
public static class PasswordRules
{
    public static IRuleBuilderOptions<T, string> MatchesPasswordPolicy<T>(this IRuleBuilder<T, string> builder) =>
        builder.NotEmpty().WithErrorCode("required").MinimumLength(8).WithErrorCode("weak");
}
public sealed class AuthValidator : AbstractValidator<Request>
{
    public AuthValidator()
    {
        RuleFor(x => x.Email).NotEmpty().WithErrorCode("required").EmailAddress().WithErrorCode("invalid");
        RuleFor(x => x.Child).SetValidator(new ChildValidator());
        RuleForEach(x => x.Items).ChildRules(item =>
        {
            item.RuleFor(x => x.Name).MaximumLength(20).WithErrorCode("long");
        });
        RuleFor(x => x.Password).MatchesPasswordPolicy();
    }
}
