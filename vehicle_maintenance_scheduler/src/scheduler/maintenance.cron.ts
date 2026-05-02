import { Elysia } from "elysia";
import { cron } from "@elysiajs/cron";
import { stmts } from "../data/vehicles.ts";
import { Log } from "@local/logging-middleware";

export const maintenanceCron = new Elysia({ name: "maintenance-cron" }).use(
  cron({
    name: "maintenanceCheck",
    pattern: "* * * * *",
    run() {
      const now = new Date().toISOString();
      console.log(`[cron] Maintenance check running at ${now}`);
      const dueVehicles = stmts.findDue.all(now);
      for (const v of dueVehicles) {
        console.log(`[cron] WARN: Vehicle ${v.name} (${v.plateNumber}) is due for maintenance`);
        void Log(
          "backend",
          "warn",
          "cron_job",
          `Vehicle ${v.name} (${v.plateNumber}) is due for maintenance`
        );
      }
      console.log("[cron] Maintenance check complete");
      void Log("backend", "info", "cron_job", "Maintenance check complete");
    },
  })
);
