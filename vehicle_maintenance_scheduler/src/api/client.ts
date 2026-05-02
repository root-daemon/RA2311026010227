import { Log } from "@local/logging-middleware";
import type { Depot, Task } from "../types/index.ts";

const BASE_URL =
  process.env.EVAL_BASE_URL ?? "http://20.207.122.201/evaluation-service";

let cachedToken = process.env.ACCESS_TOKEN ?? "";

const refreshToken = async (): Promise<void> => {
  void Log("backend", "info", "handler", "Access token expired — refreshing");
  const res = await fetch(`${BASE_URL}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: process.env.REGISTER_EMAIL,
      name: process.env.REGISTER_NAME,
      rollNo: process.env.REGISTER_ROLL_NO,
      accessCode: process.env.ACCESS_CODE,
      clientID: process.env.CLIENT_ID,
      clientSecret: process.env.CLIENT_SECRET,
    }),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
  const data = (await res.json()) as { access_token: string };
  cachedToken = data.access_token;
  void Log("backend", "info", "handler", "Access token refreshed successfully");
};

const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${cachedToken}`,
});

const fetchWithRetry = async (url: string): Promise<Response> => {
  let res = await fetch(url, { headers: authHeaders() });
  if (res.status === 401) {
    await refreshToken();
    res = await fetch(url, { headers: authHeaders() });
  }
  return res;
};

export const fetchDepots = async (): Promise<Depot[]> => {
  void Log("backend", "info", "handler", "Fetching depots from evaluation API");
  const res = await fetchWithRetry(`${BASE_URL}/depots`);
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
  const res = await fetchWithRetry(`${BASE_URL}/vehicles`);
  if (!res.ok) {
    void Log("backend", "error", "handler", `Failed to fetch vehicles: HTTP ${res.status}`);
    throw new Error(`Vehicles API returned ${res.status}`);
  }
  const data = (await res.json()) as { vehicles: Task[] };
  void Log("backend", "info", "handler", `Fetched ${data.vehicles.length} tasks`);
  return data.vehicles;
};
