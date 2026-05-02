import { Elysia, t } from "elysia";
import { Log } from "@local/logging-middleware";
import {
  addVehicle,
  listVehicles,
  recordService,
} from "../services/vehicle.service.ts";

export const vehicleRoute = new Elysia({ prefix: "/vehicles" })
  .get("/", () => {
    void Log("backend", "info", "route", "Fetching all vehicles");
    return listVehicles();
  })
  .post(
    "/",
    ({ body, set }) => {
      void Log("backend", "info", "route", `Adding vehicle: ${body.name}`);
      const vehicle = addVehicle(body);
      void Log("backend", "info", "route", `Vehicle added: ${vehicle.id}`);
      set.status = 201;
      return vehicle;
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        plateNumber: t.String({ minLength: 1 }),
        lastServiceDate: t.String(),
        serviceIntervalDays: t.Number({ minimum: 1 }),
      }),
    }
  )
  .put(
    "/:id/service",
    ({ params, set }) => {
      void Log("backend", "info", "route", `Recording service for vehicle: ${params.id}`);
      const vehicle = recordService(params.id);
      if (!vehicle) {
        void Log("backend", "warn", "route", `Vehicle not found: ${params.id}`);
        set.status = 404;
        return { error: "Vehicle not found" };
      }
      void Log("backend", "info", "route", `Service recorded for: ${vehicle.name}`);
      return vehicle;
    },
    {
      params: t.Object({ id: t.String() }),
    }
  );
