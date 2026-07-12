import { container as dependencyContainer } from "tsyringe";

export const locateOrder = () => dependencyContainer.resolve("OrderRepository");
