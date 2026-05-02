import { notifications } from "../db/store.ts";
import type { EvalNotification, Notification } from "../types/index.ts";
import { fetchExternalNotifications } from "../api/client.ts";

const TYPE_WEIGHTS: Record<string, number> = { Placement: 3, Result: 2, Event: 1 };

function priorityScore(n: EvalNotification): number {
  const ageHours = (Date.now() - new Date(n.Timestamp).getTime()) / 3_600_000;
  return (TYPE_WEIGHTS[n.Type] ?? 0) * 1000 / (1 + ageHours);
}

export const createNotification = (
  data: Pick<Notification, "title" | "message" | "type">
): Notification => {
  const notification: Notification = {
    id: crypto.randomUUID(),
    ...data,
    read: false,
    createdAt: new Date().toISOString(),
  };
  notifications.push(notification);
  return notification;
};

export const listNotifications = (read?: boolean): Notification[] => {
  if (read === undefined) return notifications;
  return notifications.filter((n) => n.read === read);
};

export const getNotificationById = (id: string): Notification | undefined =>
  notifications.find((n) => n.id === id);

export const markAsRead = (id: string): Notification | null => {
  const n = notifications.find((n) => n.id === id);
  if (!n) return null;
  n.read = true;
  return n;
};

export const deleteNotification = (id: string): boolean => {
  const idx = notifications.findIndex((n) => n.id === id);
  if (idx === -1) return false;
  notifications.splice(idx, 1);
  return true;
};

export const getExternalNotifications = (): Promise<EvalNotification[]> =>
  fetchExternalNotifications();

export const getPriorityInbox = async (count: number): Promise<EvalNotification[]> => {
  const all = await fetchExternalNotifications();
  return all
    .map((notif) => ({ notif, score: priorityScore(notif) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .map(({ notif }) => notif);
};
