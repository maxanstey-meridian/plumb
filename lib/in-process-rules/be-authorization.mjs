import { Capability, createRuleDescriptor, defineRepositoryRule } from "../engine/contracts.mjs";
import { transportClasses } from "./be-transport.mjs";
import { inBuildOutput, isCSharpTestCode } from "./helpers.mjs";

const source = "in-process/be-authorization.mjs";
const authPolicyRef = "rules/backend/apply-the-authorization-policy-at-the-endpoint.md";
const requirements = [Capability.CSHARP, Capability.DOTNET_PROJECTS, Capability.CSHARP_FACTS];

const skipFact = (context, fact) =>
  fact.line === null ||
  inBuildOutput(fact.file.path) ||
  isCSharpTestCode(context, fact.file) ||
  !context.csharpFacts.hasFacts(fact.file);

const formatGuard = (fact) =>
  fact.callee && fact.callee !== fact.roleSource ? `${fact.callee}(${fact.roleSource})` : fact.roleSource;

// MER-BE-068: static caller-role refusal guards belong in an endpoint authorization policy
// ([Authorize(Policy = ...)] or .RequireAuthorization(...)), not inside Application use cases or
// shared Application operations.
const be068 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-BE-068", source }),
  requirements,
  analyze(context) {
    const flagged = new Set();
    for (const fact of context.csharpFacts.roleGuards) {
      if (skipFact(context, fact)) continue;
      if (context.csharp.classify(fact.file).layer !== "Application") continue;
      const key = `${fact.file.path}\0${fact.line}`;
      if (flagged.has(key)) continue;
      flagged.add(key);
      context.report({
        severity: "error",
        path: fact.file.path,
        line: fact.line,
        message: `Static caller-role refusal guard (${formatGuard(fact)}) belongs in an endpoint authorization policy ([Authorize(Policy = ...)] or .RequireAuthorization(...)), not in Application`,
        docRef: authPolicyRef,
      });
    }
  },
});

// MER-BE-069: apply authentication and named authorization policies unconditionally at the
// endpoint — never gate .RequireAuthorization(...) behind a branch or perform inline caller-role
// refusal checks in controllers or endpoint handlers.
const be069 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-BE-069", source }),
  requirements,
  analyze(context) {
    const facts = context.csharpFacts;
    const flaggedConditional = new Set();
    for (const fact of facts.conditionalAuths) {
      if (skipFact(context, fact)) continue;
      const key = `${fact.file.path}\0${fact.line}`;
      if (flaggedConditional.has(key)) continue;
      flaggedConditional.add(key);
      context.report({
        severity: "error",
        path: fact.file.path,
        line: fact.line,
        message: `Conditional .${fact.method}(...) must be applied unconditionally at the endpoint`,
        docRef: authPolicyRef,
      });
    }

    const transport = transportClasses(context);
    const flaggedGuards = new Set();
    for (const fact of facts.roleGuards) {
      if (skipFact(context, fact)) continue;
      const isTransportClass = fact.from !== null && transport.names.has(fact.from);
      const isEndpointHandler = facts.handlerOf(fact) === "endpoint";
      if (!isTransportClass && !isEndpointHandler) continue;
      const key = `${fact.file.path}\0${fact.line}`;
      if (flaggedGuards.has(key)) continue;
      flaggedGuards.add(key);
      const where = isTransportClass ? facts.displayName(fact.from) : "an endpoint handler";
      context.report({
        severity: "error",
        path: fact.file.path,
        line: fact.line,
        message: `Inline caller-role refusal check (${formatGuard(fact)}) in ${where} belongs in a named authorization policy on the endpoint ([Authorize(Policy = ...)] or .RequireAuthorization(...))`,
        docRef: authPolicyRef,
      });
    }
  },
});

export const beAuthorizationRules = Object.freeze([be068, be069]);
