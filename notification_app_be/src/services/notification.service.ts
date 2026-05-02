import { stmts, toNotification } from "../db/store.ts";
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
  stmts.insert.run(
    notification.id, notification.title, notification.message,
    notification.type, 0, notification.createdAt
  );
  return notification;
};

export const listNotifications = (read?: boolean): Notification[] => {
  if (read === undefined) return stmts.findAll.all().map(toNotification);
  return stmts.findByRead.all(read ? 1 : 0).map(toNotification);
};

export const getNotificationById = (id: string): Notification | undefined => {
  const row = stmts.findById.get(id);
  return row ? toNotification(row) : undefined;
};

export const markAsRead = (id: string): Notification | null => {
  const existing = stmts.findById.get(id);
  if (!existing) return null;
  stmts.markRead.run(id);
  return toNotification({ ...existing, read: 1 });
};

export const deleteNotification = (id: string): boolean =>
  stmts.deleteById.run(id).changes > 0;

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
