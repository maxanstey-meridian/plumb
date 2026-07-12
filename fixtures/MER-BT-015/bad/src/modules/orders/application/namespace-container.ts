import * as awilix from "awilix";

const container = awilix.createContainer();
const locator = container;

export const locateRepository = () => locator.resolve("OrderRepository");
