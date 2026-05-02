import { vehicles } from "../data/vehicles.ts";
import type { Vehicle } from "../data/vehicles.ts";

export const listVehicles = (): Vehicle[] => vehicles;

export const addVehicle = (
  data: Omit<Vehicle, "id">
): Vehicle => {
  const vehicle: Vehicle = { id: crypto.randomUUID(), ...data };
  vehicles.push(vehicle);
  return vehicle;
};

export const recordService = (id: string): Vehicle | null => {
  const v = vehicles.find((v) => v.id === id);
  if (!v) return null;
  v.lastServiceDate = new Date().toISOString().split("T")[0];
  return v;
};
