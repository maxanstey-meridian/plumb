import { btRules } from "./bt.mjs";
import { btTypescriptRules } from "./bt-typescript.mjs";
import { beCSharpRules } from "./be-csharp.mjs";
import { dotnetRules } from "./dotnet-rules.mjs";
import { feGraphRules } from "./fe-graph-rules.mjs";
import { feRules } from "./fe.mjs";
import { feTypeScriptRules } from "./fe-typescript.mjs";
import { rvRules } from "./rv.mjs";
import { rvCSharpRules } from "./rv-csharp.mjs";
import { teRules } from "./te.mjs";
import { toRules } from "./to.mjs";
import { toTypeScriptRules } from "./to-typescript.mjs";

export const inProcessRules = Object.freeze([
  ...beCSharpRules,
  ...btRules,
  ...btTypescriptRules,
  ...feRules,
  ...feTypeScriptRules,
  ...feGraphRules,
  ...rvRules,
  ...rvCSharpRules,
  ...teRules,
  ...dotnetRules,
  ...toRules,
  ...toTypeScriptRules,
]);
