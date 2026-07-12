class Date {
  static now(): number {
    return 0;
  }

  constructor() {}
}

export const localNow = () => [Date.now(), new Date(), Date()];
