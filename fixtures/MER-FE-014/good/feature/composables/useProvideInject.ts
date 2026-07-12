declare function injectLocal<T>(key: symbol): T | undefined;
declare function provideLocal<T>(key: symbol, value: T): void;
declare function missingProvider(name: string): Error;

export const useProvideInject = <T>(name: string) => {
  const key = Symbol(name);
  const provideValue = (value: T): void => provideLocal(key, value);
  const injectValue = (): T => {
    const value = injectLocal<T>(key);
    if (value === undefined) {
      throw missingProvider(name);
    }
    return value;
  };
  return [injectValue, provideValue] as const;
};
