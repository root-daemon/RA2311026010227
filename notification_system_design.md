# System Design Document

## 1. Overview

This document covers two backend microservices:

1. **notification_app_be** — REST API for creating and managing notifications
2. **vehicle_maintenance_scheduler** — Optimization microservice that solves a 0/1 Knapsack problem to schedule vehicle maintenance tasks across depots within mechanic hour limits

Both use a shared **logging_middleware** package that ships structured logs to an external evaluation API on every significant operation.

---

## 2. notification_app_be Architecture

### ASCII Diagram

```
  HTTP Client
      │
      ▼
  Elysia.js (port 3001)
      │
      ├── cors plugin
      │
      ├── loggingMiddleware
      │   ├── onRequest  → Log(info, middleware, "Incoming: METHOD /path")
      │   ├── onAfterResponse → Log(info, middleware, "Completed: ... status")
      │   └── onError    → Log(error, middleware, "Error on ...")
      │
      └── notificationRoute (/notifications)
              │
              ├── POST   /           → controller → service → store[]
              ├── GET    /           → controller → service → store[]
              ├── GET    /:id        → controller → service → store[]
              ├── PATCH  /:id/read   → controller → service → store[]
              └── DELETE /:id        → controller → service → store[]
                                               │
                                         Log() ──► External Logging API
                                                   20.207.122.201
```

### Request Flow — POST /notifications

1. Client sends `POST /notifications` with `{ title, message, type }`
2. CORS headers applied
3. `loggingMiddleware.onRequest` fires → logs incoming request (fire-and-forget)
4. TypeBox validates body; invalid input → `422` before handler runs
5. `createNotificationHandler` called with destructured `{ body, set }`
6. Handler logs `"Creating notification"` via `Log()` (fire-and-forget)
7. `createNotification(body)` → generates UUID, pushes to in-memory array
8. Handler logs `"Notification created: <id>"`, sets `status = 201`, returns object
9. `loggingMiddleware.onAfterResponse` logs completion

### Notification Data Model

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` (UUID) | `crypto.randomUUID()` |
| `title` | `string` | Short heading |
| `message` | `string` | Body text |
| `type` | `"info" \| "warn" \| "error"` | Severity |
| `read` | `boolean` | Default `false` |
| `createdAt` | `string` (ISO 8601) | Creation timestamp |

---

## 3. vehicle_maintenance_scheduler Architecture

### Problem Statement

Given a set of maintenance tasks (each with a `Duration` in hours and an `Impact` score) and a set of depots (each with a `MechanicHours` budget), compute the optimal subset of tasks for each depot that **maximizes total Impact without exceeding MechanicHours**.

This is a classic **0/1 Knapsack Problem**:
- Weight = `Duration`
- Value = `Impact`
- Capacity = `MechanicHours`

### ASCII Diagram

```
  HTTP Client
      │
      ▼
  Elysia.js (port 3002)
      │
      ├── cors plugin
      │
      ├── maintenanceCron (every minute)
      │   └── checks in-memory vehicles, logs warn if due within 7 days
      │
      ├── vehicleRoute (/vehicles)
      │   ├── POST /         → addVehicle (in-memory CRUD)
      │   ├── GET  /         → listVehicles
      │   └── PUT  /:id/service → recordService (reset lastServiceDate)
      │
      └── scheduleRoute (/schedule)
              │
              ├── GET /
              │     │
              │     ├── fetchDepots() ──► GET /evaluation-service/depots
              │     ├── fetchVehicles() ► GET /evaluation-service/vehicles
              │     │
              │     └── for each depot:
              │           knapsack(tasks, depot.MechanicHours)
              │           → { selectedTasks, totalImpact, totalDuration }
              │
              └── GET /:depotId
                    │
                    ├── fetchDepots() + fetchVehicles() (parallel)
                    ├── find depot by ID
                    └── knapsack(tasks, depot.MechanicHours)
```

### Optimization Flow

```
fetchDepots()  ──┐
                 ├── Promise.all → [depots, tasks]
fetchVehicles() ─┘
                        │
              for each depot:
                        │
              ┌─────────▼──────────────────────────────────────┐
              │  0/1 Knapsack DP                                │
              │                                                  │
              │  dp[i][w] = max impact using first i tasks      │
              │             within capacity w                    │
              │                                                  │
              │  Fill table: O(n * W)                           │
              │  Traceback:  O(n)                               │
              │  Total:      O(n * W) time, O(n * W) space      │
              └─────────────────────────────────────────────────┘
                        │
              { selectedTasks, totalImpact, totalDuration }
```

### Schedule Response Schema

```json
{
  "depotId": 2,
  "mechanicHours": 135,
  "totalImpact": 187,
  "totalDuration": 134,
  "selectedTasks": [
    { "TaskID": "uuid", "Duration": 4, "Impact": 7 }
  ]
}
```

### Complexity Analysis

| Metric | Value |
|--------|-------|
| Algorithm | 0/1 Knapsack (Bottom-up DP) |
| Time complexity | O(n × W) per depot |
| Space complexity | O(n × W) |
| n (tasks) | ~30–40 (from live API) |
| W (max hours) | ~200 |
| Operations per depot | ~8,000 |
| Suitable for | Real-world scale — handles thousands of tasks efficiently |

Brute-force would be O(2^n) — infeasible at n=40 (2^40 ≈ 1 trillion operations). DP reduces this to O(n×W) which is sub-10K operations for this dataset.

---

## 4. Logging Strategy

All services use `Log(stack, level, packageName, message)` from `@local/logging-middleware`.

| Layer | Package | Level | Event |
|-------|---------|-------|-------|
| Middleware | `middleware` | `info` | Every incoming request |
| Middleware | `middleware` | `info` | Every completed response |
| Middleware | `middleware` | `error` | Unhandled errors |
| Controller | `controller` | `info` | Handler invoked |
| Controller | `controller` | `warn` | Resource not found |
| Service | `service` | `info` | Optimization start/complete |
| Service | `service` | `warn` | Depot not found |
| Handler | `handler` | `info` | External API fetch start/complete |
| Handler | `handler` | `error` | External API failure |
| Route | `route` | `info` | Route hit |
| Cron | `cron_job` | `info` | Sweep complete |
| Cron | `cron_job` | `warn` | Vehicle due for maintenance |

All `Log()` calls are fire-and-forget (`void Log(...)`) — logging failures never block request processing.

---

## 5. Error Handling

| Scenario | Behavior |
|----------|----------|
| Invalid request body | TypeBox returns `422` automatically before handler runs |
| Resource not found | Handler sets `set.status = 404`, returns `{ error: "..." }` |
| External API auth failure | `fetchDepots/fetchVehicles` throws, caught at route, returns `500` |
| Depot ID not in current set | Returns `404` with `{ error: "...", availableDepots: [...] }` |
| `Log()` network failure | Swallowed silently — app continues normally |

---

## 6. API Interaction Notes

The evaluation API returns **dynamic data** — depot IDs and task lists change on every call. Implications:

- `GET /schedule` always works — fetches fresh data and processes all current depots
- `GET /schedule/:depotId` — if the ID isn't in the current response, returns a `404` with the currently available depot IDs in `availableDepots[]`
- Both depots and vehicles are fetched in a single `Promise.all` per request to minimize API round-trips and keep data consistent within one optimization run

---

## 7. Retry and Resilience

**Current (evaluation scope):**
- No retry on external API failures — a single failure returns `500`
- No data persistence — in-memory store resets on restart
- `Log()` swallows failures silently

**Production upgrade path:**
- Exponential backoff + retry on external API calls (e.g. 3 retries with jitter)
- Redis cache for depot/vehicle data (TTL: 30s) to reduce API pressure
- Persistent DB for notification store
- Dead-letter queue for failed log entries

---

## 8. Scalability Notes

**In-memory store limitations:**
- State is per-process — horizontal scaling requires a shared store (Redis, Postgres)
- Vehicle/notification data is lost on restart

**Knapsack at scale:**
- O(n × W) scales well: 1000 tasks × 10000 hours = 10M ops — still milliseconds
- For larger datasets, consider fractional relaxation or greedy approximation as a pre-filter

**Cron at scale:**
- One cron fires per process — use a distributed lock (Redis `SETNX`) to prevent duplicate sweeps across replicas

**CORS:**
- Currently `*` (open) — restrict to known origins in production
