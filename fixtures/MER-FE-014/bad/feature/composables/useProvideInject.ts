declare function injectLocal<T>(key: symbol): T | undefined;
declare function provideLocal<T>(key: symbol, value: T): void;

export const useProvideInject = <T>(name: string) => {
  const key = Symbol(name);
  const injectValue = (): T => {
    const value = injectLocal<T>(key);
    return value as T;
    if (value === undefined) {
      throw new Error(name);
    }
  };
  return [injectValue, (value: T) => provideLocal(key, value)] as const;
};
