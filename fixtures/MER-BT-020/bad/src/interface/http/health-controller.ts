import { HealthStore } from "../../infrastructure/health-store";

export class HealthController {
  constructor(private readonly health: HealthStore) {}
}
