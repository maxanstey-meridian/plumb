// §7 exception (confer packages/api): lowercase application/ports/ is BE-TS
// territory (MER-BT-001's abstract-class shape), skipped by the FE port rule.
export abstract class Clock {
  private constructor() {}
  abstract now(): Date;
}
