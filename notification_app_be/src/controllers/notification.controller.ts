import { Log } from "@local/logging-middleware";
import {
  createNotification,
  deleteNotification,
  getNotificationById,
  listNotifications,
  markAsRead,
} from "../services/notification.service.ts";
import type { Notification } from "../types/index.ts";

type Set = { status: number | string };

export const createNotificationHandler = async ({
  body,
  set,
}: {
  body: Pick<Notification, "title" | "message" | "type">;
  set: Set;
}) => {
  void Log("backend", "info", "controller", "Creating notification");
  const result = createNotification(body);
  void Log("backend", "info", "controller", `Notification created: ${result.id}`);
  set.status = 201;
  return result;
};

export const listNotificationsHandler = async ({
  query,
}: {
  query: { read?: string };
}) => {
  void Log("backend", "info", "controller", "Fetching all notifications");
  const read =
    query.read === "true" ? true : query.read === "false" ? false : undefined;
  return listNotifications(read);
};

export const getNotificationHandler = async ({
  params,
  set,
}: {
  params: { id: string };
  set: Set;
}) => {
  void Log("backend", "info", "controller", `Fetching notification: ${params.id}`);
  const n = getNotificationById(params.id);
  if (!n) {
    void Log("backend", "warn", "controller", `Notification not found: ${params.id}`);
    set.status = 404;
    return { error: "Notification not found" };
  }
  return n;
};

export const markAsReadHandler = async ({
  params,
  set,
}: {
  params: { id: string };
  set: Set;
}) => {
  void Log("backend", "info", "controller", `Marking as read: ${params.id}`);
  const n = markAsRead(params.id);
  if (!n) {
    void Log("backend", "warn", "controller", `Notification not found: ${params.id}`);
    set.status = 404;
    return { error: "Notification not found" };
  }
  return n;
};

export const deleteNotificationHandler = async ({
  params,
  set,
}: {
  params: { id: string };
  set: Set;
}) => {
  void Log("backend", "info", "controller", `Deleting notification: ${params.id}`);
  const deleted = deleteNotification(params.id);
  if (!deleted) {
    void Log("backend", "warn", "controller", `Notification not found: ${params.id}`);
    set.status = 404;
    return { error: "Notification not found" };
  }
  void Log("backend", "info", "controller", `Notification deleted: ${params.id}`);
  return { success: true };
};
