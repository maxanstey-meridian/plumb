// Build-time mirror of plumb's namespace-boundary rules (FABLE_CONTRACT.md §11.4).
// plumb (~/Sites/plumb) is the source of truth; this analyzer re-states the
// same judgments so the compiler rejects them before plumb ever runs:
//   MERBE001 <-> MER-BE-001  Domain depends on nothing outside itself
//   MERBE002 <-> MER-BE-002  Application must not depend on Infrastructure
//   MERBE005 <-> MER-BE-005  "Never cross; always Common" (covers BE-003/004)
// Module and layer come from the file path (Modules/<X>/<Layer>/...), exactly
// like plumb's checks — namespace conventions are not trusted. Alias usings
// (`using Foo = Modules.Y.Bar;`) are also checked: plumb's regex skips them,
// but the dependency is just as real, and the compiler can afford the rigor.
// DOC: backend-pa-vsa.md#non-negotiable-dependency-rules / #across-modules
using System;
using System.Collections.Immutable;
using System.Text.RegularExpressions;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.Diagnostics;

namespace Meridian.Analyzers;

[DiagnosticAnalyzer(LanguageNames.CSharp)]
public sealed class ModuleBoundaryAnalyzer : DiagnosticAnalyzer
{
    private const string DocRoot = "meridian skill: references/backend-pa-vsa.md";

    private static readonly DiagnosticDescriptor DomainPurity = new(
        id: "MERBE001",
        title: "Domain depends on nothing outside itself",
        messageFormat: "Domain file uses '{0}' — Domain depends on nothing outside itself (MER-BE-001, {1})",
        category: "MeridianBoundaries",
        defaultSeverity: DiagnosticSeverity.Error,
        isEnabledByDefault: true);

    private static readonly DiagnosticDescriptor AppNoInfra = new(
        id: "MERBE002",
        title: "Application must not depend on Infrastructure",
        messageFormat: "Application file uses '{0}' — depend on a port instead (MER-BE-002, {1})",
        category: "MeridianBoundaries",
        defaultSeverity: DiagnosticSeverity.Error,
        isEnabledByDefault: true);

    private static readonly DiagnosticDescriptor NeverCross = new(
        id: "MERBE005",
        title: "Never cross module boundaries; always Common",
        messageFormat: "Module '{0}' uses '{1}' from module '{2}' — never cross; cross-module ports live in Common/Ports only (MER-BE-005, {3})",
        category: "MeridianBoundaries",
        defaultSeverity: DiagnosticSeverity.Error,
        isEnabledByDefault: true);

    public override ImmutableArray<DiagnosticDescriptor> SupportedDiagnostics =>
        ImmutableArray.Create(DomainPurity, AppNoInfra, NeverCross);

    private static readonly Regex CrossModule = new(@"(?:^|\.)Modules\.([A-Za-z_]\w*)", RegexOptions.Compiled);
    private static readonly Regex LayerRef = new(@"\.(Application|Infrastructure)(\.|$)", RegexOptions.Compiled);
    private static readonly Regex InfraRef = new(@"\.Infrastructure(\.|$)", RegexOptions.Compiled);
    private static readonly string[] DomainForbiddenPrefixes =
    {
        "Microsoft.AspNetCore", "Microsoft.EntityFrameworkCore", "Npgsql", "Azure.", "System.Net.Http",
    };
    private static readonly string[] AppForbiddenPrefixes =
    {
        "Microsoft.EntityFrameworkCore", "Npgsql", "Azure.",
    };

    public override void Initialize(AnalysisContext context)
    {
        context.ConfigureGeneratedCodeAnalysis(GeneratedCodeAnalysisFlags.None);
        context.EnableConcurrentExecution();
        context.RegisterSyntaxNodeAction(AnalyzeUsing, SyntaxKind.UsingDirective);
    }

    private static void AnalyzeUsing(SyntaxNodeAnalysisContext context)
    {
        var node = (UsingDirectiveSyntax)context.Node;
        var target = node.Name?.ToString();
        if (string.IsNullOrEmpty(target)) return;

        var segments = (node.SyntaxTree.FilePath ?? "").Split('/', '\\');
        var moduleIdx = Array.IndexOf(segments, "Modules");
        if (moduleIdx < 0 || moduleIdx + 1 >= segments.Length) return;
        var module = segments[moduleIdx + 1];
        var layer = moduleIdx + 2 < segments.Length ? segments[moduleIdx + 2] : "";

        var cross = CrossModule.Match(target!);
        if (cross.Success && cross.Groups[1].Value != module)
        {
            context.ReportDiagnostic(Diagnostic.Create(
                NeverCross, node.GetLocation(), module, target, cross.Groups[1].Value, DocRoot));
            return;
        }

        if (layer == "Domain" &&
            (LayerRef.IsMatch(target!) || StartsWithAny(target!, DomainForbiddenPrefixes)))
        {
            context.ReportDiagnostic(Diagnostic.Create(DomainPurity, node.GetLocation(), target, DocRoot));
        }
        else if (layer == "Application" &&
            (InfraRef.IsMatch(target!) || StartsWithAny(target!, AppForbiddenPrefixes)))
        {
            context.ReportDiagnostic(Diagnostic.Create(AppNoInfra, node.GetLocation(), target, DocRoot));
        }
    }

    private static bool StartsWithAny(string value, string[] prefixes)
    {
        foreach (var p in prefixes)
        {
            if (value.StartsWith(p, StringComparison.Ordinal) &&
                (value.Length == p.Length || value[p.Length] == '.' || p.EndsWith(".", StringComparison.Ordinal)))
                return true;
        }
        return false;
    }
}
