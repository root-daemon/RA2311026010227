import { env } from "../config/env.ts";
import type { EvalNotification } from "../types/index.ts";

const BASE = "http://20.207.122.201/evaluation-service";

export const fetchExternalNotifications = async (): Promise<EvalNotification[]> => {
  const res = await fetch(`${BASE}/notifications`, {
    headers: { Authorization: `Bearer ${env.ACCESS_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Notifications API error: ${res.status}`);
  const data = await res.json();
  return data.notifications as EvalNotification[];
};
