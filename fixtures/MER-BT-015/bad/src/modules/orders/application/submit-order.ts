import { ModuleRef as NestModuleRef } from "@nestjs/core";

export class SubmitOrder {
  constructor(private readonly moduleRef: NestModuleRef) {}

  execute(): unknown {
    return this.moduleRef.get("OrderRepository");
  }
}
