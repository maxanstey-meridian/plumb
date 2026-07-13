import { Capability, createRuleDescriptor, defineFileRule } from "../engine/contracts.mjs";
import { hasSegment, lineHits, report } from "./helpers.mjs";

const ref = "backend-pa-vsa.md#typescript--nest-naming-conventions";
const typeTag = /\.(?:port|service|provider|use-case|interface|handler)\.ts$/;
const vagueFile = /^(?:default-|base-).*\.ts$|^[^/]*-interface\.ts$/;
const rgWord = "\\p{Alphabetic}\\p{Mark}\\p{Decimal_Number}\\p{Connector_Punctuation}\\p{Join_Control}";
const rgSpace = "\\p{White_Space}";
const vagueClass = new RegExp(`(?:^|[^${rgWord}])class[${rgSpace}]+(?:[${rgWord}]+(?:Service|Interface)(?=$|[^${rgWord}])|(?:Default|Base)[A-Z][${rgWord}]*)`, "u");

export const btRules = Object.freeze([
  defineFileRule({
    descriptor: createRuleDescriptor({ id: "MER-BT-003", source: "in-process/bt.mjs" }),
    requirements: [Capability.PATH],
    files(file) {
      const name = file.split("/").at(-1);
      return (hasSegment(file, "modules") || hasSegment(file, "src")) &&
        !["node_modules", "dist", "generated", ".nuxt", "build"].some((segment) => hasSegment(file, segment)) &&
        !/\.(?:spec|test)\.ts$/.test(name) && !name.endsWith(".d.ts") && (typeTag.test(name) || vagueFile.test(name));
    },
    analyze(file, context) {
      const tagged = typeTag.test(file.name);
      report(context, "warn", file.path, 0, tagged
        ? "no type-tag suffixes — the directory carries the role; name the file after the thing itself (application/ports/clock.ts, create-form.ts)"
        : "name the file after the concrete implementation (sendgrid-mailer.ts, indexed-db-store.ts) — default-/base-/-interface names hide provenance", ref);
    },
  }),
  defineFileRule({
    descriptor: createRuleDescriptor({ id: "MER-BT-005", source: "in-process/bt.mjs" }),
    requirements: [Capability.LINE_MAP],
    files(file) {
      return (file.endsWith(".ts") || hasSegment(file, "modules")) &&
        !["__tests__", "node_modules", "dist", "generated"].some((segment) => hasSegment(file, segment)) &&
        !/\.(?:module|spec|test)\.ts$/.test(file.split("/").at(-1));
    },
    analyze(file, context) {
      for (const line of lineHits(file, vagueClass)) {
        report(context, "warn", file.path, line, "name the type after the capability or the concrete implementation — Service/Interface/Default/Base names hide provenance", ref);
      }
    },
  }),
]);
