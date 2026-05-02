import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { loggingMiddleware } from "./middlewares/logging.middleware.ts";
import { notificationRoute } from "./routes/notification.route.ts";

export const app = new Elysia()
  .use(cors())
  .use(loggingMiddleware)
  .use(notificationRoute);
