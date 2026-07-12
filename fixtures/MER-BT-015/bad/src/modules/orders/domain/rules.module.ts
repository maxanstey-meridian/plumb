import { ModuleRef as NestModuleRef } from "@nestjs/core";

export class RulesModule {
  constructor(private readonly ref: NestModuleRef) {}

  load(): unknown {
    return this.ref.get("Rule");
  }
}
