import { Elysia, t } from "elysia";
import {
  createNotificationHandler,
  deleteNotificationHandler,
  getNotificationHandler,
  getPriorityInboxHandler,
  listNotificationsHandler,
  markAsReadHandler,
} from "../controllers/notification.controller.ts";

export const notificationRoute = new Elysia({ prefix: "/notifications" })
  .get("/priority", getPriorityInboxHandler, {
    query: t.Object({ n: t.Optional(t.String()) }),
  })
  .post("/", createNotificationHandler, {
    body: t.Object({
      title: t.String({ minLength: 1 }),
      message: t.String({ minLength: 1 }),
      type: t.Union([
        t.Literal("Placement"),
        t.Literal("Result"),
        t.Literal("Event"),
      ]),
    }),
  })
  .get("/", listNotificationsHandler, {
    query: t.Object({
      read: t.Optional(t.String()),
    }),
  })
  .get("/:id", getNotificationHandler, {
    params: t.Object({ id: t.String() }),
  })
  .patch("/:id/read", markAsReadHandler, {
    params: t.Object({ id: t.String() }),
  })
  .delete("/:id", deleteNotificationHandler, {
    params: t.Object({ id: t.String() }),
  });
