export abstract class Clock {
  public format = "iso";
  public abstract now(): Date;
  public today(): string { return this.now().toISOString(); }
  public static instance(): Clock { throw new Error("nope"); }
}
