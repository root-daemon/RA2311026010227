const LOG_API =
  process.env.LOG_API ?? "http://20.207.122.201/evaluation-service/logs";

type Stack = "backend" | "frontend";
type Level = "debug" | "info" | "warn" | "error" | "fatal";
type PackageName =
  | "cache"
  | "controller"
  | "cron_job"
  | "db"
  | "domain"
  | "handler"
  | "repository"
  | "route"
  | "service"
  | "auth"
  | "config"
  | "middleware"
  | "utils";

export const Log = async (
  stack: Stack,
  level: Level,
  packageName: PackageName,
  message: string
): Promise<void> => {
  try {
    const token = process.env.ACCESS_TOKEN ?? "";
    await fetch(LOG_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ stack, level, package: packageName, message }),
    });
  } catch (err) {
    console.error("[logging-middleware] Failed to send log:", err);
  }
};

if (import.meta.main) {
  await Log("backend", "info", "utils", "logging_middleware smoke test OK");
  console.log("Smoke test log sent");
}
