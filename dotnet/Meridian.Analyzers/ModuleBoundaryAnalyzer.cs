// Build-time mirror of plumb's namespace-boundary rules (FABLE_CONTRACT.md §11.4).
// plumb (~/Sites/plumb) is the source of truth; this analyzer re-states the
// same judgments so the compiler rejects them before plumb ever runs:
//   MERBE001 <-> MER-BE-001  Domain depends on nothing outside itself
//   MERBE002 <-> MER-BE-002  Application must not depend on Infrastructure/transport
//   MERBE008 <-> MER-BE-008  Repository declarations do not belong in Domain
//   MERBE009 <-> MER-BE-009  Domain/Application do not use a service locator
//   MERBE005 <-> MER-BE-005  Sibling internals do not escape (covers BE-003/004)
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

    private static readonly DiagnosticDescriptor CrossesModuleInternals = new(
        id: "MERBE005",
        title: "Do not depend on sibling module internals",
        messageFormat: "Module '{0}' uses internal type '{1}' from module '{2}' — consume a published contract or bridge a required port at composition (MER-BE-005, {3})",
        category: "MeridianBoundaries",
        defaultSeverity: DiagnosticSeverity.Error,
        isEnabledByDefault: true);

    private static readonly DiagnosticDescriptor DomainRepository = new(
        id: "MERBE008",
        title: "Repository declarations belong in Application",
        messageFormat: "Repository declaration '{0}' is in Domain — move the port to Application/Ports (MER-BE-008, {1})",
        category: "MeridianBoundaries",
        defaultSeverity: DiagnosticSeverity.Error,
        isEnabledByDefault: true);

    private static readonly DiagnosticDescriptor ServiceLocator = new(
        id: "MERBE009",
        title: "Do not use a service locator",
        messageFormat: "'{0}' hides a dependency — inject the required port directly (MER-BE-009, {1})",
        category: "MeridianBoundaries",
        defaultSeverity: DiagnosticSeverity.Error,
        isEnabledByDefault: true);

    public override ImmutableArray<DiagnosticDescriptor> SupportedDiagnostics =>
        ImmutableArray.Create(DomainPurity, AppNoInfra, CrossesModuleInternals, DomainRepository, ServiceLocator);

    private static readonly Regex CrossModule = new(@"(?:^|\.)Modules\.([A-Za-z_]\w*)", RegexOptions.Compiled);
    private static readonly Regex LayerRef = new(@"\.(Application|Infrastructure)(\.|$)", RegexOptions.Compiled);
    private static readonly Regex InfraRef = new(@"\.Infrastructure(\.|$)", RegexOptions.Compiled);
    private static readonly string[] DomainForbiddenPrefixes =
    {
        "Microsoft.AspNetCore", "Microsoft.EntityFrameworkCore", "Microsoft.Extensions.Logging",
        "OpenTelemetry", "FluentResults", "Npgsql", "Azure.", "System.Net.Http",
    };
    private static readonly string[] AppForbiddenPrefixes =
    {
        "Microsoft.AspNetCore", "Microsoft.EntityFrameworkCore", "System.Net.Http", "Npgsql", "Azure.",
    };

    public override void Initialize(AnalysisContext context)
    {
        context.ConfigureGeneratedCodeAnalysis(GeneratedCodeAnalysisFlags.None);
        context.EnableConcurrentExecution();
        context.RegisterSyntaxNodeAction(AnalyzeUsing, SyntaxKind.UsingDirective);
        context.RegisterSyntaxNodeAction(AnalyzeTypeReference, SyntaxKind.IdentifierName, SyntaxKind.GenericName);
        context.RegisterSyntaxNodeAction(AnalyzeDomainRepository, SyntaxKind.InterfaceDeclaration, SyntaxKind.ClassDeclaration);
        context.RegisterSyntaxNodeAction(AnalyzeServiceLocatorIdentifier, SyntaxKind.IdentifierName);
        context.RegisterSyntaxNodeAction(AnalyzeServiceLocatorInvocation, SyntaxKind.InvocationExpression);
    }

    private static void AnalyzeTypeReference(SyntaxNodeAnalysisContext context)
    {
        var node = (SimpleNameSyntax)context.Node;
        if (IsInsideUsing(node) || !TryGetModuleLayer(node.SyntaxTree, out var module, out var layer)) return;

        var symbol = context.SemanticModel.GetSymbolInfo(node, context.CancellationToken).Symbol;
        var type = symbol switch
        {
            INamedTypeSymbol namedType => namedType,
            IAliasSymbol { Target: INamedTypeSymbol aliasedType } => aliasedType,
            _ => null,
        };
        if (type is null) return;

        var targetNamespace = type.ContainingNamespace.ToDisplayString();
        var targetType = type.ToDisplayString();
        var cross = CrossModule.Match(targetNamespace);
        if (cross.Success && cross.Groups[1].Value != module &&
            (layer == "Domain" || !IsPublishedContract(targetNamespace, cross.Groups[1].Value)))
        {
            context.ReportDiagnostic(Diagnostic.Create(
                CrossesModuleInternals, node.GetLocation(), module, targetType, cross.Groups[1].Value, DocRoot));
            return;
        }

        if (layer == "Domain" &&
            (LayerRef.IsMatch(targetNamespace) || StartsWithAny(targetNamespace, DomainForbiddenPrefixes)))
        {
            context.ReportDiagnostic(Diagnostic.Create(DomainPurity, node.GetLocation(), targetType, DocRoot));
        }
        else if (layer == "Application" &&
            (InfraRef.IsMatch(targetNamespace) || StartsWithAny(targetNamespace, AppForbiddenPrefixes)))
        {
            context.ReportDiagnostic(Diagnostic.Create(AppNoInfra, node.GetLocation(), targetType, DocRoot));
        }
    }

    private static void AnalyzeUsing(SyntaxNodeAnalysisContext context)
    {
        var node = (UsingDirectiveSyntax)context.Node;
        var target = node.Name?.ToString();
        if (string.IsNullOrEmpty(target)) return;

        if (!TryGetModuleLayer(node.SyntaxTree, out var module, out var layer)) return;

        var cross = CrossModule.Match(target!);
        if (cross.Success && cross.Groups[1].Value != module &&
            (layer == "Domain" || !IsPublishedContract(target!, cross.Groups[1].Value)))
        {
            context.ReportDiagnostic(Diagnostic.Create(
                CrossesModuleInternals, node.GetLocation(), module, target, cross.Groups[1].Value, DocRoot));
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

    private static void AnalyzeDomainRepository(SyntaxNodeAnalysisContext context)
    {
        if (!TryGetModuleLayer(context.Node.SyntaxTree, out _, out var layer) || layer != "Domain") return;

        string? name = null;
        if (context.Node is InterfaceDeclarationSyntax iface &&
            iface.Identifier.ValueText.StartsWith("I", StringComparison.Ordinal) &&
            iface.Identifier.ValueText.EndsWith("Repository", StringComparison.Ordinal))
        {
            name = iface.Identifier.ValueText;
        }
        else if (context.Node is ClassDeclarationSyntax cls &&
            cls.Identifier.ValueText.EndsWith("Repository", StringComparison.Ordinal))
        {
            name = cls.Identifier.ValueText;
        }

        if (name is not null)
            context.ReportDiagnostic(Diagnostic.Create(DomainRepository, context.Node.GetLocation(), name, DocRoot));
    }

    private static void AnalyzeServiceLocatorIdentifier(SyntaxNodeAnalysisContext context)
    {
        var identifier = (IdentifierNameSyntax)context.Node;
        if (!IsDomainOrApplication(identifier.SyntaxTree) || IsInsideUsing(identifier)) return;
        var alias = context.SemanticModel.GetAliasInfo(identifier, context.CancellationToken);
        var type = alias?.Target as INamedTypeSymbol ??
            context.SemanticModel.GetSymbolInfo(identifier, context.CancellationToken).Symbol as INamedTypeSymbol;
        if (type is null ||
            type.Name != "IServiceProvider" || type.ContainingNamespace.ToDisplayString() != "System") return;
        context.ReportDiagnostic(Diagnostic.Create(ServiceLocator, identifier.GetLocation(), "IServiceProvider", DocRoot));
    }

    private static void AnalyzeServiceLocatorInvocation(SyntaxNodeAnalysisContext context)
    {
        if (!IsDomainOrApplication(context.Node.SyntaxTree)) return;
        var invocation = (InvocationExpressionSyntax)context.Node;
        if (context.SemanticModel.GetSymbolInfo(invocation, context.CancellationToken).Symbol is not IMethodSymbol method ||
            method.Name is not ("GetService" or "GetRequiredService")) return;

        var definition = method.ReducedFrom ?? method;
        var isSystemProviderMember = definition.ContainingType?.ToDisplayString() == "System.IServiceProvider";
        var isMicrosoftDiExtension = definition.IsExtensionMethod &&
            definition.ContainingType?.Name == "ServiceProviderServiceExtensions" &&
            definition.ContainingNamespace.ToDisplayString() == "Microsoft.Extensions.DependencyInjection";
        if (isSystemProviderMember || isMicrosoftDiExtension)
            context.ReportDiagnostic(Diagnostic.Create(ServiceLocator, invocation.GetLocation(), method.Name, DocRoot));
    }

    private static bool IsDomainOrApplication(SyntaxTree tree) =>
        TryGetModuleLayer(tree, out _, out var layer) && layer is "Domain" or "Application";

    private static bool IsInsideUsing(SyntaxNode node)
    {
        for (var current = node.Parent; current is not null; current = current.Parent)
        {
            if (current is UsingDirectiveSyntax) return true;
        }
        return false;
    }

    private static bool TryGetModuleLayer(SyntaxTree tree, out string module, out string layer)
    {
        var segments = (tree.FilePath ?? "").Split('/', '\\');
        var moduleIdx = Array.IndexOf(segments, "Modules");
        if (moduleIdx < 0 || moduleIdx + 1 >= segments.Length)
        {
            module = "";
            layer = "";
            return false;
        }
        module = segments[moduleIdx + 1];
        layer = moduleIdx + 2 < segments.Length ? segments[moduleIdx + 2] : "";
        return true;
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

    private static bool IsPublishedContract(string target, string module) =>
        Regex.IsMatch(target, $@"(?:^|\.)Modules\.{Regex.Escape(module)}\.Contracts(?:\.|$)");
}
