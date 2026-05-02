import { Elysia, t } from "elysia";
import {
  createNotificationHandler,
  deleteNotificationHandler,
  getNotificationHandler,
  listNotificationsHandler,
  markAsReadHandler,
} from "../controllers/notification.controller.ts";

export const notificationRoute = new Elysia({ prefix: "/notifications" })
  .post("/", createNotificationHandler, {
    body: t.Object({
      title: t.String({ minLength: 1 }),
      message: t.String({ minLength: 1 }),
      type: t.Union([t.Literal("info"), t.Literal("warn"), t.Literal("error")]),
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
