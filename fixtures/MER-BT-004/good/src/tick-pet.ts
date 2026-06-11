export class TickPet {
  public static inject = ["clock"] as const;
  public constructor(private readonly clock: Clock) {}
}
