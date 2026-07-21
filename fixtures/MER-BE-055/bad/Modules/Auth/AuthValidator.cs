namespace App.Modules.Auth;
public static class PasswordRules
{
    public static IRuleBuilderOptions<T, string> MatchesPasswordPolicy<T>(this IRuleBuilder<T, string> builder) =>
        builder.NotEmpty();
}
public sealed class AuthValidator : AbstractValidator<Request>
{
    public AuthValidator()
    {
        RuleFor(x => x.Email).NotEmpty().MaximumLength(200).WithErrorCode("long");
        RuleForEach(x => x.Items).ChildRules(item =>
        {
            item.RuleFor(x => x.Name).Must(name => name.Length > 0);
        });
        RuleFor(x => x.Password).MatchesPasswordPolicy();
    }
}
