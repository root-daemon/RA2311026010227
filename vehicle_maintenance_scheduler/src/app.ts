import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { maintenanceCron } from "./scheduler/maintenance.cron.ts";
import { vehicleRoute } from "./routes/vehicle.route.ts";
import { scheduleRoute } from "./routes/schedule.route.ts";

export const app = new Elysia()
  .use(cors())
  .use(maintenanceCron)
  .use(vehicleRoute)
  .use(scheduleRoute);
