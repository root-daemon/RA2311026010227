import { Elysia } from "elysia";
import { cron } from "@elysiajs/cron";
import { vehicles } from "../data/vehicles.ts";
import { Log } from "@local/logging-middleware";

const DAYS_AHEAD = 7;

export const maintenanceCron = new Elysia({ name: "maintenance-cron" }).use(
  cron({
    name: "maintenanceCheck",
    pattern: "* * * * *",
    run() {
      const now = new Date().toISOString();
      console.log(`[cron] Maintenance check running at ${now}`);
      const thresholdMs = Date.now() + DAYS_AHEAD * 86_400_000;
      for (const v of vehicles) {
        const dueMs =
          new Date(v.lastServiceDate).getTime() +
          v.serviceIntervalDays * 86_400_000;
        if (dueMs <= thresholdMs) {
          console.log(`[cron] WARN: Vehicle ${v.name} (${v.plateNumber}) is due for maintenance`);
          void Log(
            "backend",
            "warn",
            "cron_job",
            `Vehicle ${v.name} (${v.plateNumber}) is due for maintenance`
          );
        }
      }
      console.log("[cron] Maintenance check complete");
      void Log("backend", "info", "cron_job", "Maintenance check complete");
    },
  })
);
