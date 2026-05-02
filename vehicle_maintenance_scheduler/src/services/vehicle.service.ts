import { stmts } from "../data/vehicles.ts";
import type { Vehicle } from "../data/vehicles.ts";

export const listVehicles = (): Vehicle[] =>
  stmts.findAll.all() as Vehicle[];

export const addVehicle = (data: Omit<Vehicle, "id">): Vehicle => {
  const vehicle: Vehicle = { id: crypto.randomUUID(), ...data };
  stmts.insert.run(
    vehicle.id, vehicle.name, vehicle.plateNumber,
    vehicle.lastServiceDate, vehicle.serviceIntervalDays
  );
  return vehicle;
};

export const recordService = (id: string): Vehicle | null => {
  const existing = stmts.findById.get(id) as Vehicle | null;
  if (!existing) return null;
  const today = new Date().toISOString().split("T")[0];
  stmts.updateService.run(today, id);
  return { ...existing, lastServiceDate: today };
};
