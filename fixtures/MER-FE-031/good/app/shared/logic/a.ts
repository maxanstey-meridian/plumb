// a and b import each other; counting consumers through the cycle still terminates.
import { isB } from "~/shared/logic/b";
export const isA = (value: string): boolean => value === "a" || isB(value.slice(1));
