import { isA } from "~/shared/logic/a";
export const isB = (value: string): boolean => value === "b" || isA(value.slice(1));
