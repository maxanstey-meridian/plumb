import { Capability, createRuleDescriptor, defineRepositoryRule } from "../engine/contracts.mjs";
import { matchingCSharpDelimiter } from "../engine/dotnet-analysis.mjs";

const source = "in-process/rv-csharp.mjs";
const practicalRules = "rivet.md#practical-rules";
const twoWaysIn = "rivet.md#two-ways-in";
const endpointComposition = "rivet.md#endpoint-composition";

const report = (context, id, severity, file, line, message, docRef) => context.report({
  id,
  severity,
  path: file.path,
  line,
  message,
  docRef,
});

const isTestSource = (context, file) => context.dotnetProjects.testEvidence(file).test;

const depthAt = (text, end) => {
  let depth = 0;
  for (let index = 0; index < end; index++) {
    if (text[index] === "{") depth++;
    else if (text[index] === "}") depth--;
  }
  return depth;
};

const methodBlock = (text) => {
  const declaration = /\b(?:public|internal|private|protected)\s+[^;{}=]+?\b[A-Za-z_]\w*\s*\(/s;
  const first = declaration.exec(text);
  if (!first) return text;
  const after = first.index + first[0].length;
  const next = declaration.exec(text.slice(after));
  return next ? text.slice(first.index, after + next.index) : text.slice(first.index);
};

const matchingEnd = (text, open, opening, closing) => {
  let depth = 1;
  let end = open + 1;
  while (end < text.length && depth) {
    if (text[end] === opening) depth++;
    else if (text[end] === closing) depth--;
    end++;
  }
  return end;
};

const rv001 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-RV-001", source }),
  requirements: [Capability.CSHARP, Capability.DOTNET_PROJECTS],
  analyze(context) {
    for (const file of context.csharp.csharpFiles) {
      if (isTestSource(context, file)) continue;
      const masked = context.csharp.mask(file);
      for (const match of masked.matchAll(/\[RivetClient\b[^\]]*\]/g)) {
        report(context, "MER-RV-001", "warn", file, file.lineMap().lineAt(match.index),
          "prefer an explicit [RivetContract] contract class — [RivetClient] is the shortcut mode", twoWaysIn);
      }
    }
  },
});

const rv002 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-RV-002", source }),
  requirements: [Capability.CSHARP, Capability.DOTNET_PROJECTS],
  analyze(context) {
    const filesByProject = new Map();
    for (const file of context.csharp.csharpFiles) {
      if (isTestSource(context, file)) continue;
      const project = context.dotnetProjects.nearestProject(file);
      const key = project?.path ?? "";
      if (!filesByProject.has(key)) filesByProject.set(key, []);
      filesByProject.get(key).push(file);
    }
    for (const files of filesByProject.values()) {
      if (!files.some((file) => /\[RivetContract\b[^\]]*\]/.test(context.csharp.mask(file)))) continue;
      for (const file of files) {
        if (file.name === "Program.cs") continue;
        const masked = context.csharp.mask(file, { preserveStringDelimiters: true });
        const pattern = /(?:\[Http(?:Get|Post|Put|Delete|Patch)|\.Map(?:Get|Post|Put|Delete|Patch))\(\s*(?:@|\$)*"/g;
        for (const match of masked.matchAll(pattern)) {
          report(context, "MER-RV-002", "error", file, file.lineMap().lineAt(match.index),
            "literal route in a contract-bearing project — use the contract route (e.g. [HttpPost(XContract.CreateRoute)] / Contract.X.Route)", practicalRules);
        }
      }
    }
  },
});

const rv003 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-RV-003", source }),
  requirements: [Capability.CSHARP, Capability.DOTNET_PROJECTS],
  analyze(context) {
    // The contract field must be used in the handler block: bound via .Bind, or
    // answered through one of the Rivet terminals (.Success/.Error/.File). Formatters
    // split `Contract\n    .Field.Success(`, so member access may span whitespace. Like Rivet's
    // --check, a local holding the field (`var endpoint = XContract.List;`) stands for it.
    const terminal = String.raw`\s*\.\s*(?:Bind|Success|Error|File)\s*\(`;
    const emit = (file, route, start, block, contract, fields, target) => {
      const field = String.raw`\b${contract}\s*\.\s*(?:${fields?.join("|") ?? String.raw`[A-Za-z_]\w*`})`;
      if (new RegExp(field + terminal).test(block)) return;
      for (const [, local] of block.matchAll(new RegExp(String.raw`\b([A-Za-z_]\w*)\s*=\s*${field}\s*;`, "g"))) {
        if (new RegExp(String.raw`\b${local}${terminal}`).test(block)) return;
      }
      report(context, "MER-RV-003", "warn", file, file.lineMap().lineAt(start),
        `handler route references ${route} but the following handler block has no .Bind or terminal (.Success/.Error/.File) call on ${target}`, practicalRules);
    };
    const emitField = (file, route, start, block) => {
      const [contract, field] = route.split(".");
      emit(file, route, start, block, contract, [field], "it");
    };

    // A controller attribute needs a compile-time constant, so it names the contract's
    // `const string` route rather than a field's runtime .Route. Names don't map a const to its
    // field (DraftRoute can serve GetDraft and SaveDraft), so the contract does: the fields
    // whose initialiser is Define.<Verb>(<Const>), narrowed to the handler's verb. The contract is
    // the type the written name resolves to, read from its own (non-test) declarations; one outside
    // the scan, or ambiguous, leaves any of its fields acceptable. A const that backs no field is a
    // plain ASP.NET route (an OIDC redirect, say), not a Rivet handler; one that backs fields only
    // for other verbs is usually a verb mismatch. A composed route (`BaseRoute + "/{id}"`) names no
    // single field, so any of its contract's fields for that verb will do, and a contract with none
    // for that verb is again a plain ASP.NET route.
    const constRoute = /\b([A-Za-z_]\w*Contract)\.([A-Za-z_]\w*Route)\b(?!\s*\.)/;
    const defineVerbs = { Get: ["Get", "File"], Post: ["Post"], Put: ["Put"], Delete: ["Delete"], Patch: ["Patch"] };
    const definition = /\bstatic\s+readonly\s+[^=;{}]+?\b([A-Za-z_]\w*)\s*=\s*Define\s*\.\s*(Get|Post|Put|Patch|Delete|File)\b[^(;]*\(\s*(?:route\s*:\s*)?(?:(?:[A-Za-z_]\w*Contract\s*\.\s*)?([A-Za-z_]\w*)\s*[),])?/g;
    const contractFields = new Map();
    const fieldsOf = (written, file, offset) => {
      const declarations = (context.csharp.resolveType(written, file, offset)?.declarations ?? [])
        .filter((declaration) => !isTestSource(context, declaration.file));
      if (!declarations.length) return null;
      const key = declarations.map((declaration) => `${declaration.file.path}:${declaration.offset}`).join("|");
      if (!contractFields.has(key)) {
        const fields = [];
        for (const declaration of declarations) {
          const text = context.csharp.mask(declaration.file);
          const header = /[^{;]*([{;])/y;
          header.lastIndex = declaration.offset;
          const opening = header.exec(text);
          if (opening?.[1] !== "{") continue;
          const open = header.lastIndex - 1;
          const body = text.slice(open + 1, matchingEnd(text, open, "{", "}") - 1);
          for (const [, name, defineVerb, constName] of body.matchAll(definition)) fields.push({ name, defineVerb, constName });
        }
        contractFields.set(key, fields);
      }
      return contractFields.get(key);
    };
    const httpVerb = (defineVerb) => defineVerb === "File" ? "Get" : defineVerb;
    const list = (values) => values.length > 1 ? `${values.slice(0, -1).join(", ")} and ${values.at(-1)}` : values[0];
    const emitConst = (file, verb, written, contract, constant, start, block, composed = false) => {
      const defined = fieldsOf(written, file, start);
      let fields = null;
      if (defined) {
        const backing = composed ? defined : defined.filter(({ constName }) => constName === constant);
        fields = backing.filter(({ defineVerb }) => defineVerbs[verb].includes(defineVerb)).map(({ name }) => name);
        if (!fields.length) {
          if (!composed && backing.length) report(context, "MER-RV-003", "warn", file, file.lineMap().lineAt(start),
            `handler is Http${verb} but ${contract}.${constant} backs only ${list([...new Set(backing.map(({ defineVerb }) => httpVerb(defineVerb)))])} fields (${backing.map(({ name }) => name).join(", ")}) — use the matching verb, or add the field`, practicalRules);
          return;
        }
      }
      const target = fields ? fields.map((name) => `${contract}.${name}`).join(" or ") : `any ${contract} field`;
      emit(file, `${contract}.${constant}`, start, block, contract, fields, target);
    };

    const verbs = "(Get|Post|Put|Delete|Patch)";
    const nextHandler = String.raw`([\s\S]*?)(?=\[Http(?:Get|Post|Put|Delete|Patch)\b|$)`;
    // Only a Map* call can take a field's runtime .Route; an attribute argument must be a constant.
    const fieldRoute = /\b([A-Za-z_]\w*Contract\.[A-Za-z_]\w*)\.Route\b/;
    // The attribute's route argument: positional or `template:`, the contract optionally namespace-qualified,
    // then `,`/`)` (the whole route) or `+` (composed).
    const routeArgument = String.raw`(?:template\s*:\s*)?((?:global::)?(?:[A-Za-z_]\w*\s*\.\s*)*?)${constRoute.source}\s*([,)+])`;
    const attributed = new RegExp(String.raw`\[Http${verbs}\s*\(\s*${routeArgument}[^\]]*\]${nextHandler}`, "g");
    const mapped = new RegExp(String.raw`\bMap${verbs}\s*\(\s*(?:${fieldRoute.source}|${constRoute.source})\s*,`, "g");
    for (const file of context.csharp.csharpFiles) {
      if (!file.name.endsWith("Controller.cs") && !file.name.endsWith("Endpoints.cs")) continue;
      // Comments and string contents are blanked (offsets kept), so neither a commented-out handler
      // nor a commented-out .Bind counts.
      const text = context.csharp.mask(file);
      for (const match of text.matchAll(attributed)) {
        const [, verb, qualifier, contract, constant, delimiter, rest] = match;
        emitConst(file, verb, qualifier + contract, contract, constant, match.index, methodBlock(rest), delimiter === "+");
      }

      const routedClass = /\[Route\s*\([^\]]*?\b([A-Za-z_]\w*Contract)\.BaseRoute\b[^\]]*\)\s*\][^{]*\bclass\b[^{]*\{/g;
      for (const match of text.matchAll(routedClass)) {
        const open = match.index + match[0].length - 1;
        const end = matchingEnd(text, open, "{", "}");
        const body = text.slice(open + 1, end - 1);
        const handlers = new RegExp(String.raw`\[Http(?:Get|Post|Put|Delete|Patch)(?:\s*\(([^\]]*)\))?\s*\]${nextHandler}`, "g");
        for (const handlerMatch of body.matchAll(handlers)) {
          const handler = methodBlock(handlerMatch[2]);
          // A handler naming its own contract route is checked by the attributed pass above.
          if (handlerMatch[1] !== undefined && new RegExp(String.raw`^\s*${routeArgument}`).test(`${handlerMatch[1]})`)) continue;
          const method = /\b(?:public|internal|private|protected)\s+[^;{}=]+?\b([A-Za-z_]\w*)\s*\(/s.exec(handler)?.[1];
          if (method) emitField(file, `${match[1]}.${method}`, open + 1 + handlerMatch.index, handler);
        }
        routedClass.lastIndex = end;
      }

      for (let match; (match = mapped.exec(text));) {
        const [, verb, route, contract, constant] = match;
        const open = text.indexOf("(", match.index);
        const end = matchingEnd(text, open, "(", ")");
        const block = text.slice(open + 1, end - 1);
        if (route) emitField(file, route, match.index, block);
        else emitConst(file, verb, contract, contract, constant, match.index, block);
        mapped.lastIndex = end;
      }
    }
  },
});

const rv006 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-RV-006", source }),
  requirements: [Capability.CSHARP, Capability.DOTNET_PROJECTS],
  analyze(context) {
    const message = "[RivetContract] classes may contain only const strings and static readonly RouteDefinition fields";
    for (const file of context.csharp.csharpFiles) {
      if (isTestSource(context, file)) continue;
      const masked = context.csharp.mask(file);
      const declaration = /\[RivetContract\b[^\]]*\]\s*((?:(?:public|internal|private|protected|abstract|sealed|static|partial)\s+)*)class\s+[A-Za-z_]\w*Contract\b[^{]*\{/g;
      for (const match of masked.matchAll(declaration)) {
        if (!/\bstatic\b/.test(match[1])) report(context, "MER-RV-006", "warn", file, file.lineMap().lineAt(match.index),
          "[RivetContract] must annotate a static contract declaration", twoWaysIn);
        const open = match.index + match[0].lastIndexOf("{");
        const end = matchingEnd(masked, open, "{", "}");
        const body = masked.slice(open + 1, end - 1);
        const bodyLine = file.lineMap().lineAt(open + 1);
        const reported = new Set();
        const method = /(?:^|[;}])(\s*(?:(?:public|internal|private|protected|static|async|virtual|override|sealed|new|unsafe|extern|partial)\s+)*(?:[\w:<>,.?\[\]]+\s+)+[A-Za-z_]\w*\s*)\(/gms;
        for (const member of body.matchAll(method)) {
          const memberOffset = member.index + member[0].indexOf(member[1]);
          if (depthAt(body, memberOffset) !== 0) continue;
          const start = memberOffset + member[1].search(/\S/);
          const line = bodyLine + body.slice(0, start).split("\n").length - 1;
          reported.add(line);
          report(context, "MER-RV-006", "warn", file, line, message, twoWaysIn);
        }
        for (const [offset, lineSource] of body.split(/\r?\n/).entries()) {
          if (!/^\s*(?:public|internal|private|protected)\s+(?:static\s+)?(?!const\s+string\b)(?:readonly\s+|const\s+)?[\w:<>,.?\[\]]+\s+\w+\s*(?:=>|=|;|\{\s*(?:get|set|init)\b)/.test(lineSource) ||
              /\bstatic\s+readonly\s+.*RouteDefinition/.test(lineSource)) continue;
          const line = bodyLine + offset;
          if (!reported.has(line)) report(context, "MER-RV-006", "warn", file, line, message, twoWaysIn);
        }
      }
    }
  },
});

// Rivet ships the transport adapters (`.ToResult()` / `.ToActionResult()` in namespace Rivet); an app that
// writes its own extension off RivetResult named like them or returning an HTTP result is a hand-written bridge
// beside them, unless its body goes through them (a helper owning an error path).
const httpResults = new Set([
  // Minimal API results and the Microsoft.AspNetCore.Http.HttpResults typed results.
  "IResult", "Results", "Ok", "Created", "CreatedAtRoute", "Accepted", "AcceptedAtRoute", "NoContent", "NotFound",
  "BadRequest", "Conflict", "UnprocessableEntity", "InternalServerError", "ValidationProblem",
  // MVC results.
  "IActionResult", "ActionResult", "ObjectResult", "OkObjectResult", "OkResult", "JsonResult", "ContentResult",
  "StatusCodeResult", "NoContentResult", "NotFoundResult", "NotFoundObjectResult", "BadRequestResult",
  "BadRequestObjectResult", "CreatedResult", "CreatedAtActionResult", "CreatedAtRouteResult", "AcceptedResult",
  "ConflictObjectResult", "UnprocessableEntityObjectResult", "FileResult", "FileContentResult", "FileStreamResult",
  "PhysicalFileResult", "EmptyResult", "RedirectResult", "RedirectToActionResult", "RedirectToRouteResult", "LocalRedirectResult",
  "UnauthorizedResult", "ForbidResult", "ChallengeResult", "ConflictResult", "UnprocessableEntityResult", "AcceptedAtActionResult",
  "AcceptedAtRouteResult",
  // Azure Functions isolated worker.
  "HttpResponseData",
]);
// `Task<Results<Ok, NotFound>>`, `ValueTask<IActionResult>`, `Microsoft.AspNetCore.Http.HttpResults.Ok<T>`, `JsonHttpResult<T>`.
const returnsHttpResult = (type) => {
  let name = type.replace(/\s+/g, "").replace(/^global::/, "");
  for (let unwrapped; (unwrapped = /^(?:[\w.]+\.)?(?:Task|ValueTask)<(.+)>\??$/.exec(name));) name = unwrapped[1].replace(/^global::/, "");
  const outer = /^(?:\w+\.)*(\w+)/.exec(name)?.[1] ?? "";
  return httpResults.has(outer) || outer.endsWith("HttpResult");
};
// The end of the statement or expression starting at `from`: the first `;` outside brackets.
function statementEnd(text, from) {
  for (let index = from, depth = 0; index < text.length; index++) {
    if ("([{".includes(text[index])) depth++;
    else if (")]}".includes(text[index])) { if (!depth--) return index; }
    else if (text[index] === ";" && !depth) return index;
  }
  return text.length;
}

// Building an HTTP result itself (`Results.Json`, `new ObjectResult`, `Problem(…)`), or reading what Rivet's adapter
// produced (`RivetActionResult`, whose StatusCode and Value a bridge copies into a result of its own).
const NATIVE_RESULT = /\b(?:Results|TypedResults)\s*\.|\bnew\s+(?:[\w.]+\.)?\w*Result\b|\b(?:Problem|ValidationProblem|StatusCode|CreateResponse)\s*\(|\bRivetActionResult\b/;
// A returned expression that ends in Rivet's adapter, awaited or not.
const ADAPTED = /\.\s*To(?:Action)?Result\s*\(\s*\)(?:\s*\.\s*ConfigureAwait\s*\([^()]*\))?\s*$/;
const STATEMENT_WORDS = new Set(["if", "while", "for", "foreach", "switch", "catch", "using", "lock", "fixed", "return", "await", "new", "nameof", "typeof", "sizeof", "when", "else", "throw", "yield", "case", "in", "is", "as"]);

// The top-level parts of `text` split at `separator` (a `,` or the `:` of a ?:), outside brackets.
function topLevelSplit(text, separator) {
  const parts = [];
  let depth = 0, start = 0;
  for (let index = 0; index < text.length; index++) {
    if ("([{".includes(text[index])) depth++;
    else if (")]}".includes(text[index])) depth--;
    else if (text[index] === separator && !depth) { parts.push(text.slice(start, index)); start = index + 1; }
  }
  return [...parts, text.slice(start)];
}

// The values a returned expression can produce: each arm of a top-level ?:, each arm of a switch expression,
// and each lambda body of a call made only of lambdas (`.Match(ok => …, error => …)`), down to plain values.
function arms(expression) {
  const value = expression.replace(/^\s*await\b/, "").trim();
  let depth = 0;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if ("([{".includes(character)) depth++;
    else if (")]}".includes(character)) depth--;
    else if (character === "?" && !depth && !"?.[".includes(value[index + 1]) && value[index - 1] !== "?") {
      // The `:` that closes this ?: is the first top-level one not taken by a nested ?:.
      let nested = 0;
      for (let colon = index + 1, inner = 0; colon < value.length; colon++) {
        const next = value[colon];
        if ("([{".includes(next)) inner++;
        else if (")]}".includes(next)) inner--;
        else if (next === "?" && !inner && !"?.[".includes(value[colon + 1]) && value[colon - 1] !== "?") nested++;
        else if (next === ":" && !inner && !nested--) return [...arms(value.slice(index + 1, colon)), ...arms(value.slice(colon + 1))];
      }
      return [value];
    }
  }
  // `subject switch { pattern => arm, … }` whose braces close the expression.
  depth = 0;
  for (let index = 0; index < value.length; index++) {
    if ("([{".includes(value[index])) depth++;
    else if (")]}".includes(value[index])) depth--;
    const keyword = !depth && /^\bswitch\s*\{/.exec(value.slice(index));
    if (!keyword || /\w/.test(value[index - 1] ?? "")) continue;
    const brace = index + keyword[0].length - 1;
    if (matchingCSharpDelimiter(value, brace) !== value.length - 1) break;
    return topLevelSplit(value.slice(brace + 1, -1), ",").filter((arm) => arm.trim()).flatMap((arm) => {
      const arrow = arm.indexOf("=>");
      return arrow < 0 ? [arm] : arms(arm.slice(arrow + 2));
    });
  }
  if (value.endsWith(")")) {
    const open = (() => { for (let index = value.length - 1, inner = 0; index >= 0; index--) {
      if (value[index] === ")") inner++;
      else if (value[index] === "(" && !--inner) return index;
    } return -1; })();
    const args = open > 0 ? topLevelSplit(value.slice(open + 1, -1), ",") : [];
    if (args.length && args.every((arg) => /^\s*(?:\w+\s*:\s*)?(?:\w+|\([^()]*\))\s*=>/.test(arg))) {
      return args.flatMap((arg) => arms(arg.slice(arg.indexOf("=>") + 2)));
    }
  }
  return [value];
}

// Blanks the bodies of the lambdas, anonymous delegates and local functions inside a method body: their own
// returns are not the method's.
function ownStatements(body) {
  let own = body;
  const blank = (open) => {
    const end = matchingCSharpDelimiter(own, open);
    if (end > open) own = own.slice(0, open + 1) + " ".repeat(end - open - 1) + own.slice(end);
  };
  for (const lambda of body.matchAll(/(?:=>|\bdelegate\b\s*(?:\([^()]*\))?)\s*\{/g)) blank(lambda.index + lambda[0].length - 1);
  for (const local of body.matchAll(/\b([A-Za-z_][\w<>?,.[\]]*)\s+([A-Za-z_]\w*)\s*(?:<[^<>()]*>)?\s*\(/g)) {
    if (STATEMENT_WORDS.has(local[1]) || STATEMENT_WORDS.has(local[2])) continue;
    const open = local.index + local[0].length - 1, close = matchingCSharpDelimiter(own, open);
    const brace = close > 0 ? /^\s*\{/.exec(own.slice(close + 1)) : null;
    if (brace) blank(close + brace[0].length);
  }
  return own;
}

// Whether the method whose parameter list opens at `open` is a helper that goes through Rivet's adapter: every
// value it returns, arm by arm, ends in .ToResult()/.ToActionResult() and it builds no HTTP result of its own. A
// bridge has to call the adapter too (the result's status and body are internal), then copies its output into
// a new result, so calling it somewhere is not enough.
function adapts(text, open) {
  const close = matchingCSharpDelimiter(text, open);
  if (close < 0) return false;
  const start = /^[^{;]*?(\{|=>)/s.exec(text.slice(close + 1));
  if (!start) return false;
  const from = close + 1 + start[0].length;
  const block = start[1] === "{";
  const to = block ? matchingCSharpDelimiter(text, from - 1) : statementEnd(text, from);
  const body = text.slice(from, to < 0 ? text.length : to);
  if (NATIVE_RESULT.test(body)) return false;
  const own = block ? ownStatements(body) : body;
  const returned = block
    ? [...own.matchAll(/\breturn\b/g)].map((match) => own.slice(match.index + match[0].length, statementEnd(own, match.index + match[0].length)))
    : [body];
  return returned.length > 0 && returned.flatMap(arms).every((value) => ADAPTED.test(value.trim()));
}

const rv007 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-RV-007", source }),
  requirements: [Capability.CSHARP, Capability.DOTNET_PROJECTS],
  analyze(context) {
    const modifiers = /^(?:(?:public|internal|private|protected|static|async|new|unsafe|extern|partial|override|virtual|sealed|readonly)\s+)*/;
    const extension = /\bstatic\b([^;{}()=]*?)\s+([A-Za-z_]\w*)\s*(?:<\s*\w+(?:\s*,\s*\w+)*\s*>)?\s*\(\s*this\s+(?:global::)?(?:\w+\.)*RivetResult\b/g;
    // RivetActionResult is what Rivet's .ToActionResult() returns. App code only names it to copy its status and
    // body into a result of its own, wherever that sits: a cast in a plain helper, an `is` pattern in a filter.
    const adapterOutput = /\bRivetActionResult\b/g;
    const readsAdapterOutput = (subject) => `${subject} reads RivetActionResult, the output of Rivet's .ToActionResult() adapter, which only a hand-written bridge needs — return .ToResult()/.ToActionResult() directly instead`;
    for (const file of context.csharp.csharpFiles) {
      const text = context.csharp.mask(file);
      const namespaceName = /\bnamespace\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*[;{]/.exec(text)?.[1] ?? "";
      if (/^Rivet(?:\.|$)/.test(namespaceName)) continue;
      // Tests may read the adapter's output to assert on it.
      const appCode = !isTestSource(context, file);
      const classes = [...text.matchAll(/\bclass\s+(\w+)\b/g)];
      // Top-level statements, usings and anything else before the first class: each reference at its own line.
      if (appCode) {
        const lines = new Set([...text.slice(0, classes[0]?.index ?? text.length).matchAll(adapterOutput)]
          .map((match) => file.lineMap().lineAt(match.index)));
        for (const line of lines) {
          report(context, "MER-RV-007", "warn", file, line, readsAdapterOutput("Code outside any class"), "rivet.md#minimal-apis");
        }
      }
      for (const [index, classMatch] of classes.entries()) {
        const end = classes[index + 1]?.index ?? text.length;
        const body = text.slice(classMatch.index, end);
        const bridges = [], namesakes = [];
        for (const match of body.matchAll(extension)) {
          const [, returnType, name] = match;
          if (adapts(body, match.index + match[0].lastIndexOf("("))) continue;
          if (returnsHttpResult(returnType.trim().replace(modifiers, ""))) bridges.push(name);
          else if (/^To(?:Action)?Result$/.test(name)) namesakes.push(name);
        }
        const line = file.lineMap().lineAt(classMatch.index);
        if (bridges.length) {
          report(context, "MER-RV-007", "warn", file, line,
            `${classMatch[1]} hand-writes an HTTP-result bridge off RivetResult (${[...new Set(bridges)].join(", ")}) — delete it and use Rivet's first-party .ToResult()/.ToActionResult() adapters`, "rivet.md#minimal-apis");
        }
        if (namesakes.length) {
          report(context, "MER-RV-007", "warn", file, line,
            `${classMatch[1]} declares its own ${[...new Set(namesakes)].join(", ")} off RivetResult, so a handler's call may bind to it instead of Rivet's first-party adapter — rename or delete it`, "rivet.md#minimal-apis");
        }
        // A class already reported as a bridge needs no second finding for the cast inside it.
        if (appCode && !bridges.length && body.search(adapterOutput) >= 0) {
          report(context, "MER-RV-007", "warn", file, line, readsAdapterOutput(classMatch[1]), "rivet.md#minimal-apis");
        }
      }
    }
  },
});

const rv008 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-RV-008", source }),
  requirements: [Capability.CSHARP, Capability.DOTNET_PROJECTS],
  analyze(context) {
    for (const program of context.csharp.csharpFiles) {
      if (program.name !== "Program.cs") continue;
      const text = context.csharp.source(program);
      const masked = context.csharp.mask(program);
      for (const match of masked.matchAll(/\.Map([A-Za-z_]\w*)\s*\(/g)) {
        const name = match[1];
        if (name === "Group" || name.endsWith("Endpoints")) continue;
        const open = match.index + match[0].length - 1;
        let argument = open + 1;
        while (/\s/.test(masked[argument] ?? "")) argument++;
        if (masked[argument] === ")") continue;
        const route = /^\s*"((?:\\.|[^"\\])*)"/s.exec(text.slice(open + 1))?.[1];
        if (route === "/" || route && /^\/(?:api\/)?health(?:\/|$)/.test(route)) continue;
        report(context, "MER-RV-008", "warn", program, program.lineMap().lineAt(match.index),
          "compose MapXEndpoints in Program.cs instead of inline business endpoint handlers", endpointComposition);
      }

      const mappings = new Set();
      for (const endpoint of context.csharp.csharpFiles) {
        if (!endpoint.path.startsWith(program.directory ? `${program.directory}/` : "") || !endpoint.name.endsWith("Endpoints.cs")) continue;
        for (const match of context.csharp.source(endpoint).matchAll(/\bMap[A-Za-z_][A-Za-z0-9_]*Endpoints\s*\(/g)) {
          mappings.add(match[0].replace(/\s*\($/, ""));
        }
      }
      for (const mapping of [...mappings].sort()) {
        if (new RegExp(`\\.${mapping}\\s*\\(`).test(masked)) continue;
        report(context, "MER-RV-008", "warn", program, 0, `Program.cs must compose ${mapping}`, endpointComposition);
      }
    }
  },
});

const rv009 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-RV-009", source }),
  requirements: [Capability.CSHARP],
  analyze(context) {
    for (const file of context.csharp.csharpFiles) {
      if (!file.name.endsWith("Endpoints.cs")) continue;
      if (file.path.split("/").some((segment) => segment === "obj" || segment === "bin")) continue;
      const text = context.csharp.source(file);
      const extensions = /\bMap[A-Za-z_][A-Za-z0-9_]*Endpoints\s*\(\s*this\s+((?:global::)?[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s+[A-Za-z_]\w*/g;
      for (const match of text.matchAll(extensions)) {
        const globallyQualified = match[1].startsWith("global::");
        const type = match[1].replace(/^global::/, "");
        if (type === "IEndpointRouteBuilder" || type === "Microsoft.AspNetCore.Routing.IEndpointRouteBuilder") continue;
        report(context, "MER-RV-009", "warn", file, globallyQualified ? 1 : file.lineMap().lineAt(match.index),
          "MapXEndpoints extensions must target Microsoft.AspNetCore.Routing.IEndpointRouteBuilder", endpointComposition);
      }
    }
  },
});

const rv010 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-RV-010", source }),
  requirements: [Capability.CSHARP, Capability.DOTNET_PROJECTS],
  analyze(context) {
    for (const file of context.csharp.csharpFiles) {
      if (isTestSource(context, file)) continue;
      if (!/\[RivetContract\b[^\]]*\]/.test(context.csharp.mask(file))) continue;
      const project = context.dotnetProjects.nearestProject(file);
      const relative = project?.directory ? file.path.slice(project.directory.length + 1) : file.path;
      if (!/^Contracts\/[^/]+\/[^/]+\.cs$/.test(relative)) report(context, "MER-RV-010", "error", file, 0,
        "contract classes live directly in top-level Contracts/{Module}/", "rivet.md#contract-location");
    }
  },
});

const rv011 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-RV-011", source }),
  requirements: [Capability.CSHARP, Capability.DOTNET_PROJECTS],
  analyze(context) {
    const wrappers = new Set([
      "Array", "Dictionary", "Enumerable", "HashSet", "ICollection", "IDictionary", "IEnumerable",
      "IList", "IReadOnlyCollection", "IReadOnlyDictionary", "IReadOnlyList", "List", "Nullable",
      "Task", "ValueTask", "ValueTuple",
    ]);
    const leaves = new Set([
      "bool", "byte", "char", "DateOnly", "DateTime", "DateTimeOffset", "decimal", "double",
      "float", "Guid", "int", "long", "object", "sbyte", "short", "string", "TimeOnly", "TimeSpan", "uint",
      "ulong", "Uri", "ushort", "void",
    ]);
    // Each payload type name resolves as the compiler would from the contract file; one outside the scan, or
    // ambiguous between usings, isn't judged. Partial parts (or one name in several projects) must agree.
    const inspect = (file, owner, typeSource, offset) => {
      const reported = new Set();
      for (const token of typeSource.matchAll(/(?:global::)?[A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*)*/g)) {
        const name = token[0].replace(/^global::/, "").split(".").at(-1).trim();
        if (wrappers.has(name) || leaves.has(name) || reported.has(name)) continue;
        const candidates = (context.csharp.resolveType(token[0], file, offset + token.index)?.declarations ?? [])
          .filter((declaration) => !isTestSource(context, declaration.file));
        const placements = new Set(candidates.map(({ file: declared }) => {
          const { contract, contractOwner, common } = context.csharp.classify(declared);
          return `${contract}:${contractOwner}:${common}`;
        }));
        if (placements.size !== 1) continue;
        const target = context.csharp.classify(candidates[0].file);
        if ((name === "ErrorResponse" || name === "PaginatedResponse") && target.common) continue;
        if (target.contract === "transport" && target.contractOwner === owner) continue;
        reported.add(name);
        report(context, "MER-RV-011", "error", file, file.lineMap().lineAt(offset + token.index),
          `route payload ${name} is owned by ${target.contract ? `${target.contract} contract ${target.contractOwner}` : candidates[0].file.path} — define it in Contracts/${owner}/`,
          "rivet.md#route-payload-ownership");
      }
    };

    for (const file of context.csharp.csharpFiles) {
      if (isTestSource(context, file)) continue;
      const classification = context.csharp.classify(file);
      if (classification.contract !== "transport" || !/\[RivetContract\b[^\]]*\]/.test(context.csharp.mask(file))) continue;
      const masked = context.csharp.mask(file), owner = classification.contractOwner;
      const payload = /\b(?:RouteDefinition|InputRouteDefinition|FileRouteDefinition)\s*</g;
      for (const match of masked.matchAll(payload)) {
        const open = masked.indexOf("<", match.index), close = matchingCSharpDelimiter(masked, open, "<", ">");
        if (close < 0) continue;
        inspect(file, owner, masked.slice(open + 1, close), open + 1);
      }
      for (const match of masked.matchAll(/\.Returns\s*</g)) {
        const open = masked.indexOf("<", match.index), close = matchingCSharpDelimiter(masked, open, "<", ">");
        if (close < 0) continue;
        inspect(file, owner, masked.slice(open + 1, close), open + 1);
      }
    }
  },
});

export const rvCSharpRules = Object.freeze([
  rv001,
  rv002,
  rv003,
  rv006,
  rv007,
  rv008,
  rv009,
  rv010,
  rv011,
]);
