namespace App.Modules.Submissions.Domain;

// Submissions' own read model of a form: it maps Forms' table by name, with no Forms name written.
public sealed class FormRef
{
    public Guid Id { get; set; }
}
