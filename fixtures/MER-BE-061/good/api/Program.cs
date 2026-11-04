using App.Integration;
using App.Modules.CaseTypes.Application.Ports;

namespace App;

public static class Program
{
    public static IOpenCaseQuery Register() => new OpenCaseQueryAdapter();
}
