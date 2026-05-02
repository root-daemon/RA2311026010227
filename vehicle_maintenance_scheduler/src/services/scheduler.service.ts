import { Log } from "@local/logging-middleware";
import { fetchDepots, fetchVehicles } from "../api/client.ts";
import { knapsack } from "../utils/knapsack.ts";
import type { ScheduleResult } from "../types/index.ts";

const buildResults = (depots: Awaited<ReturnType<typeof fetchDepots>>, tasks: Awaited<ReturnType<typeof fetchVehicles>>): ScheduleResult[] =>
  depots.map((depot) => {
    void Log(
      "backend",
      "info",
      "service",
      `Running knapsack for depot ${depot.ID} — capacity: ${depot.MechanicHours}h, tasks: ${tasks.length}`
    );
    const { selectedTasks, totalImpact, totalDuration } = knapsack(tasks, depot.MechanicHours);
    void Log(
      "backend",
      "info",
      "service",
      `Depot ${depot.ID} done — selected ${selectedTasks.length} tasks, impact: ${totalImpact}, duration: ${totalDuration}h`
    );
    return { depotId: depot.ID, mechanicHours: depot.MechanicHours, totalImpact, totalDuration, selectedTasks };
  });

export const computeAllSchedules = async (): Promise<ScheduleResult[]> => {
  void Log("backend", "info", "service", "Optimization started for all depots");
  const [depots, tasks] = await Promise.all([fetchDepots(), fetchVehicles()]);
  const results = buildResults(depots, tasks);
  void Log("backend", "info", "service", `Optimization complete — ${results.length} depots processed`);
  return results;
};

export const computeScheduleForDepot = async (
  depotId: number
): Promise<ScheduleResult> => {
  void Log("backend", "info", "service", `Optimization started for depot ${depotId}`);

  // Fetch both in one round-trip — depot IDs are dynamic, so we fetch the
  // current set and filter rather than making a separate targeted call.
  const [depots, tasks] = await Promise.all([fetchDepots(), fetchVehicles()]);

  const depot = depots.find((d) => d.ID === depotId);
  if (!depot) {
    const available = depots.map((d) => d.ID);
    void Log("backend", "warn", "service", `Depot ${depotId} not found. Available: ${available.join(", ")}`);
    const err = new Error(`Depot ${depotId} not found. Available depot IDs: ${available.join(", ")}`);
    (err as any).availableDepots = available;
    throw err;
  }

  const { selectedTasks, totalImpact, totalDuration } = knapsack(tasks, depot.MechanicHours);
  void Log(
    "backend",
    "info",
    "service",
    `Depot ${depotId} done — impact: ${totalImpact}, duration: ${totalDuration}h`
  );
  return { depotId: depot.ID, mechanicHours: depot.MechanicHours, totalImpact, totalDuration, selectedTasks };
};
