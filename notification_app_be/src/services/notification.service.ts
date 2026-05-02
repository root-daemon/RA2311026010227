import { notifications } from "../db/store.ts";
import type { Notification } from "../types/index.ts";

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
