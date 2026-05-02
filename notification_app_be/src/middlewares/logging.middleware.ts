import { Elysia } from "elysia";
import { Log } from "@local/logging-middleware";

export const loggingMiddleware = new Elysia({ name: "logging-middleware" })
  .onRequest(({ request }) => {
    const path = new URL(request.url).pathname;
    void Log("backend", "info", "middleware", `Incoming: ${request.method} ${path}`);
  })
  .onAfterResponse(({ request, set }) => {
    const path = new URL(request.url).pathname;
    void Log(
      "backend",
      "info",
      "middleware",
      `Completed: ${request.method} ${path} ${set.status}`
    );
  })
  .onError(({ error, request }) => {
    const path = new URL(request.url).pathname;
    void Log(
      "backend",
      "error",
      "middleware",
      `Error on ${request.method} ${path}: ${(error as Error).message}`
    );
  });
