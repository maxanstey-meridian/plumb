export class TickPet {
  public static inject = ["clock"];
  public constructor(clock: Clock) {
    void clock;
  }
}
