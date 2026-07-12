export const queueName = process.env.ORDER_QUEUE;
export const region = process["env"].AWS_REGION;
export const bunPort = Bun.env.PORT;
export const denoPort = Deno.env.get("PORT");
