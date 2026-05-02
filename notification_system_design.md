# Notification System Design

## 1. Overview

This document describes the architecture of a notification backend service built with Bun and Elysia.js. The system exposes a REST API for creating and managing notifications, with structured logging sent to an external evaluation API on every operation.

---

## 2. Architecture Diagram

```
                         ┌─────────────────────────────────────┐
  HTTP Client            │         notification_app_be          │
  (Postman/curl)         │                                      │
       │                 │  Elysia.js (port 3001)               │
       │ HTTP request    │                                      │
       ▼                 │  ┌─────────────────────────────┐    │
  ─────────────          │  │  cors plugin                │    │
       │                 │  ├─────────────────────────────┤    │
       │                 │  │  loggingMiddleware           │    │
       │                 │  │  onRequest / onAfterResponse │    │
       │                 │  │  onError                    │    │
       │                 │  ├─────────────────────────────┤    │
       │                 │  │  notificationRoute           │    │
       │                 │  │  POST   /notifications       │    │
       │                 │  │  GET    /notifications       │    │
       │                 │  │  GET    /notifications/:id   │    │
       │                 │  │  PATCH  /notifications/:id/read│  │
       │                 │  │  DELETE /notifications/:id   │    │
       │                 │  └────────────┬────────────────┘    │
       │                 │               │                      │
       │                 │  ┌────────────▼────────────────┐    │
       │                 │  │  NotificationController      │    │
       │                 │  └────────────┬────────────────┘    │
       │                 │               │                      │
       │                 │  ┌────────────▼────────────────┐    │
       │                 │  │  NotificationService         │    │
       │                 │  │  (pure functions)            │    │
       │                 │  └────────────┬────────────────┘    │
       │                 │               │                      │
       │                 │  ┌────────────▼────────────────┐    │
       │                 │  │  In-Memory Store             │    │
       │                 │  │  Notification[]              │    │
       │                 │  └─────────────────────────────┘    │
       │                 │                                      │
       │                 │  ┌─────────────────────────────┐    │
       │                 │  │  Log() — fire-and-forget     │    │
       │                 │  └────────────┬────────────────┘    │
       │                 └───────────────┼──────────────────────┘
       │                                 │
       ◄──── HTTP response               │ POST /evaluation-service/logs
                                         ▼
                               ┌──────────────────────┐
                               │  External Logging API │
                               │  20.207.122.201       │
                               └──────────────────────┘
```

---

## 3. Request Flow — POST /notifications

1. Client sends `POST /notifications` with JSON body `{ title, message, type }`
2. Elysia CORS plugin adds appropriate headers
3. `loggingMiddleware.onRequest` fires → `Log("backend", "info", "middleware", "Incoming: POST /notifications")` (fire-and-forget)
4. TypeBox validates the body; if invalid, Elysia returns `422 Unprocessable Entity` before the handler runs
5. `createNotificationHandler` is called with destructured `{ body, set }`
6. Handler fires `Log("backend", "info", "controller", "Creating notification")` (fire-and-forget)
7. Handler calls `createNotification(body)` → service creates a `Notification` object with `crypto.randomUUID()` and pushes to the in-memory array
8. Handler fires `Log("backend", "info", "controller", "Notification created: <id>")` (fire-and-forget)
9. Handler sets `set.status = 201` and returns the new notification object
10. `loggingMiddleware.onAfterResponse` fires → `Log("backend", "info", "middleware", "Completed: POST /notifications 201")`
11. Client receives `201 Created` with the notification JSON

---

## 4. In-Memory Data Model

### Notification

| Field       | Type                        | Description                                 |
|-------------|-----------------------------|---------------------------------------------|
| `id`        | `string` (UUID)             | Unique identifier, generated via `crypto.randomUUID()` |
| `title`     | `string`                    | Short heading for the notification          |
| `message`   | `string`                    | Full notification body text                 |
| `type`      | `"info" \| "warn" \| "error"` | Severity/category of the notification     |
| `read`      | `boolean`                   | Whether the notification has been read; defaults to `false` |
| `createdAt` | `string` (ISO 8601)         | Timestamp of creation                       |

Storage: `const notifications: Notification[] = []` — a module-level mutable array shared across all requests within the same process.

---

## 5. Logging Strategy

Every significant operation emits a structured log via `Log(stack, level, packageName, message)`. Logs are fire-and-forget (`void Log(...)`) so they never block the request cycle.

| Layer       | Package name   | Level   | When                                      |
|-------------|----------------|---------|-------------------------------------------|
| Middleware  | `middleware`   | `info`  | On every incoming request                 |
| Middleware  | `middleware`   | `info`  | After every completed response            |
| Middleware  | `middleware`   | `error` | On unhandled errors                       |
| Controller  | `controller`   | `info`  | At the start of each handler              |
| Controller  | `controller`   | `info`  | After a successful create/delete          |
| Controller  | `controller`   | `warn`  | When a resource is not found              |
| Cron job    | `cron_job`     | `warn`  | When a vehicle is due for maintenance     |
| Cron job    | `cron_job`     | `info`  | After each maintenance check sweep        |
| Route       | `route`        | `info`  | On vehicle CRUD operations                |
| Route       | `route`        | `warn`  | When a vehicle is not found               |

All logs use `stack: "backend"`.

---

## 6. Error Handling

**TypeBox validation (422):** Elysia validates request body, query, and params against TypeBox schemas before the handler runs. Invalid input returns a `422 Unprocessable Entity` with details automatically — no handler code needed.

**Not found (404):** Handlers check service return values. When a resource is not found, the handler sets `set.status = 404` and returns `{ error: "..." }`. No exceptions are thrown.

**Log() failures:** `Log()` wraps its `fetch()` call in a `try/catch`. Failures are printed to `console.error` and swallowed — the logging API being unavailable never affects the application's own responses.

**Unhandled errors:** `loggingMiddleware.onError` catches any unhandled Elysia errors, logs them at `error` level, and lets Elysia return its default error response.

---

## 7. Retry and Resilience Strategy

**Current approach (in-memory, evaluation scope):**
- `Log()` does not retry. If the logging API is temporarily down, the log entry is lost silently. Acceptable for evaluation; not for production.
- In-memory store has no persistence. Data is lost on process restart. This is intentional for a stateless evaluation service.

**Production upgrade path:**
- Replace `notifications: Notification[]` with a Postgres/Redis-backed repository. The service layer interface stays the same — only `db/store.ts` changes.
- Add retry logic in `Log()` with exponential backoff and a dead-letter queue for failed log entries.
- Use a message queue (e.g., BullMQ, RabbitMQ) to decouple notification creation from delivery.

---

## 8. Scalability Notes

**Horizontal scaling limitations:**
- The in-memory store is local to each process instance. Running multiple instances means each has its own independent state — requests routed to different instances will see different notification lists.

**Migration path:**
- **Database**: Replace the in-memory array with a Postgres table or Redis sorted set behind the service interface.
- **Session stickiness**: Use a load balancer with sticky sessions as an intermediate step before migrating to a real DB.
- **CORS**: Current config uses wildcard (`*`). In production, restrict to known client origins: `cors({ origin: ['https://your-domain.com'] })`.

**vehicle_maintenance_scheduler scaling:**
- The cron job runs per-instance. With multiple instances, multiple cron sweeps will fire simultaneously — use a distributed lock (e.g., Redis `SETNX`) to ensure only one instance runs the sweep per interval.
