import { Log } from "@local/logging-middleware";
import type { Depot, Task } from "../types/index.ts";

const BASE_URL =
  process.env.EVAL_BASE_URL ?? "http://20.207.122.201/evaluation-service";

const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${process.env.ACCESS_TOKEN ?? ""}`,
});

export const fetchDepots = async (): Promise<Depot[]> => {
  void Log("backend", "info", "handler", "Fetching depots from evaluation API");
  const res = await fetch(`${BASE_URL}/depots`, { headers: authHeaders() });
  if (!res.ok) {
    void Log("backend", "error", "handler", `Failed to fetch depots: HTTP ${res.status}`);
    throw new Error(`Depots API returned ${res.status}`);
  }
  const data = (await res.json()) as { depots: Depot[] };
  void Log("backend", "info", "handler", `Fetched ${data.depots.length} depots`);
  return data.depots;
};

export const fetchVehicles = async (): Promise<Task[]> => {
  void Log("backend", "info", "handler", "Fetching vehicles from evaluation API");
  const res = await fetch(`${BASE_URL}/vehicles`, { headers: authHeaders() });
  if (!res.ok) {
    void Log("backend", "error", "handler", `Failed to fetch vehicles: HTTP ${res.status}`);
    throw new Error(`Vehicles API returned ${res.status}`);
  }
  const data = (await res.json()) as { vehicles: Task[] };
  void Log("backend", "info", "handler", `Fetched ${data.vehicles.length} tasks`);
  return data.vehicles;
};
