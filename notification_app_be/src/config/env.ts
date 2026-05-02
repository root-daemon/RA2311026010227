if (!process.env.ACCESS_TOKEN) {
  console.warn("[config] ACCESS_TOKEN is not set — logging calls will fail silently");
}

export const env = {
  PORT: Number(process.env.PORT ?? 3001),
  LOG_API: process.env.LOG_API ?? "http://20.207.122.201/evaluation-service/logs",
  ACCESS_TOKEN: process.env.ACCESS_TOKEN ?? "",
} as const;
