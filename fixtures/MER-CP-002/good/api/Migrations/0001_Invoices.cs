namespace App.Migrations;

public static class Invoices
{
    public const string Up = "CREATE TRIGGER invoices_immutable BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION refuse_paid_change();";
}
