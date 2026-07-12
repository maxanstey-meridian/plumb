import { env as runtimeEnvironment } from "node:process";

export const queue = runtimeEnvironment.ORDER_QUEUE;
