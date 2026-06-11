// §7 exception (glyphantics): *.module.ts is the composition root — importing
// sibling Nest modules there is framework wiring, not a boundary leak.
import { BillingModule } from "../billing/billing.module";
export class AuthModule { static imports = [BillingModule]; }
