import { Log } from "@local/logging-middleware";
import type { EvalNotification } from "../types/index.ts";

const BASE_URL =
  process.env.EVAL_BASE_URL ?? "http://20.207.122.201/evaluation-service";

const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${process.env.ACCESS_TOKEN ?? ""}`,
});

export const fetchExternalNotifications = async (): Promise<EvalNotification[]> => {
  void Log("backend", "info", "handler", "Fetching notifications from evaluation API");
  const res = await fetch(`${BASE_URL}/notifications`, { headers: authHeaders() });
  if (!res.ok) {
    void Log("backend", "error", "handler", `Failed to fetch notifications: HTTP ${res.status}`);
    throw new Error(`Notifications API returned ${res.status}`);
  }
  const data = (await res.json()) as { notifications: EvalNotification[] };
  void Log("backend", "info", "handler", `Fetched ${data.notifications.length} notifications`);
  return data.notifications;
};
