import { Clock } from "../application/ports/clock.js";
export class SystemClock extends Clock {
  public now(): Date { return new Date(); }
}
