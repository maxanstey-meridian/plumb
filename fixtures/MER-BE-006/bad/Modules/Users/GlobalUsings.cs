// A global using in a module brings the name into scope project-wide; it does not make Users a consumer of RetryBudget.
global using UsersBudget = Acme.Common.RetryBudget;
