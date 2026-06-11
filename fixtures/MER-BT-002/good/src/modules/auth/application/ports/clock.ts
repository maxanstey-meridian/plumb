export abstract class Clock {
  private constructor() {}
  public abstract now(): Date;
}
