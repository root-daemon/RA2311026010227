import { Elysia, t } from "elysia";
import { Log } from "@local/logging-middleware";
import {
  computeAllSchedules,
  computeScheduleForDepot,
} from "../services/scheduler.service.ts";

export const scheduleRoute = new Elysia({ prefix: "/schedule" })
  .get("/", async ({ set }) => {
    void Log("backend", "info", "route", "GET /schedule — optimizing all depots");
    try {
      const results = await computeAllSchedules();
      return results;
    } catch (err) {
      void Log("backend", "error", "handler", `GET /schedule failed: ${(err as Error).message}`);
      set.status = 500;
      return { error: (err as Error).message };
    }
  })
  .get(
    "/:depotId",
    async ({ params, set }) => {
      const depotId = Number(params.depotId);
      if (isNaN(depotId)) {
        set.status = 400;
        return { error: "depotId must be a number" };
      }
      void Log("backend", "info", "route", `GET /schedule/${depotId}`);
      try {
        const result = await computeScheduleForDepot(depotId);
        return result;
      } catch (err) {
        const e = err as Error & { availableDepots?: number[] };
        void Log("backend", "error", "handler", `GET /schedule/${depotId} failed: ${e.message}`);
        if (e.availableDepots) {
          set.status = 404;
          return { error: e.message, availableDepots: e.availableDepots };
        }
        set.status = 500;
        return { error: e.message };
      }
    },
    { params: t.Object({ depotId: t.String() }) }
  );
