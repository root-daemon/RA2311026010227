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

---

# Stage 1

## REST API Design

### Naming Conventions
- Base path: `/notifications`
- Kebab-case paths, plural resource nouns
- Query params for filtering, path params for resource identity

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/notifications` | Create a new notification |
| `GET` | `/notifications` | List notifications (filterable) |
| `GET` | `/notifications/:id` | Get single notification |
| `PATCH` | `/notifications/:id/read` | Mark notification as read |
| `DELETE` | `/notifications/:id` | Delete a notification |
| `GET` | `/notifications/unread-count` | Count of unread notifications |
| `GET` | `/notifications/priority` | Top N priority notifications |

### Headers (all requests)
```
Authorization: Bearer <token>
Content-Type: application/json
Accept: application/json
```

### Request / Response Schemas

**POST /notifications**
```json
Request:
{ "title": "string (required)", "message": "string (required)", "type": "Placement|Result|Event (required)" }

Response 201:
{ "id": "uuid", "title": "...", "message": "...", "type": "Placement", "read": false, "createdAt": "2026-04-22T17:51:18.000Z" }

Response 422:
{ "type": "validation", "on": "body", "summary": "...", "errors": [...] }
```

**GET /notifications**
```
Query params:
  ?read=true|false        (optional — filter by read status)
  ?type=Placement|Result|Event  (optional — filter by type)
  ?page=1&limit=20        (optional — pagination)

Response 200:
{ "notifications": [ { "id": "...", "title": "...", "message": "...", "type": "...", "read": false, "createdAt": "..." } ], "total": 42 }
```

**GET /notifications/unread-count**
```json
Response 200:
{ "count": 7 }
```

**PATCH /notifications/:id/read**
```json
Response 200:
{ "id": "...", "title": "...", "message": "...", "type": "...", "read": true, "createdAt": "..." }

Response 404:
{ "error": "Notification not found" }
```

**GET /notifications/priority**
```
Query params:
  ?n=10   (optional — top N, default 10, max 100)

Response 200:
{ "notifications": [ { "ID": "uuid", "Type": "Placement", "Message": "CSX Corporation hiring", "Timestamp": "2026-04-22 17:51:18" } ] }
```

### Real-Time Notification Design

**Chosen mechanism: Server-Sent Events (SSE)**

SSE is preferred over raw WebSocket for one-directional server-push (notifications are server → client only). It uses a standard HTTP connection, supports automatic reconnect, and works through proxies without extra setup.

**SSE Endpoint:**
```
GET /notifications/stream
Headers: Authorization: Bearer <token>
         Accept: text/event-stream
```

**SSE Event Format:**
```
event: notification
data: {"ID":"uuid","Type":"Placement","Message":"CSX Corporation hiring","Timestamp":"2026-04-22T17:51:18Z"}

event: ping
data: {"ts":1745344278}
```

**Flow:**
```
Client                          Server
  │                               │
  ├── GET /notifications/stream ──►│
  │   Accept: text/event-stream   │
  │◄── 200 Content-Type: text/    │
  │       event-stream ───────────│
  │                               │
  │◄── event: notification ───────│  (new notification arrives)
  │    data: { ... }              │
  │                               │
  │◄── event: ping ───────────────│  (keepalive every 30s)
  │    data: { ts: ... }          │
  │                               │
  │    [connection dropped]       │
  ├── reconnect with Last-Event-ID►│  (browser auto-reconnects)
```

**WebSocket alternative** (for bidirectional use, e.g. marking as read in real time):
```
ws://host/notifications/ws
Client → { "action": "mark_read", "id": "uuid" }
Server → { "event": "notification", "data": { ... } }
```

---

# Stage 2

## Database Design

### Choice: PostgreSQL

**Why PostgreSQL:**
- ACID compliance — critical for "exactly once" notification delivery guarantees
- Supports JSONB for flexible message metadata without schema migration
- Native `ENUM` type for notification categories
- Row-level locking for safe concurrent `mark_as_read` updates
- Mature ecosystem (pgBouncer for connection pooling, PgBouncer, read replicas)
- `LISTEN/NOTIFY` for lightweight internal pub-sub without Redis dependency

**Why not NoSQL (MongoDB, DynamoDB):**
- No multi-document ACID for mass inserts with audit trail
- Eventual consistency risks duplicate notification display
- Weaker query flexibility for complex filters + pagination

### Schema

```sql
CREATE TYPE notification_type AS ENUM ('Placement', 'Result', 'Event');

CREATE TABLE students (
  student_id   BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  name         TEXT        NOT NULL,
  email        TEXT UNIQUE NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id   BIGINT       NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
  type         notification_type NOT NULL,
  title        TEXT         NOT NULL,
  message      TEXT         NOT NULL,
  is_read      BOOLEAN      NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);
```

### Indexes

```sql
-- Primary query pattern: unread notifications for a student, newest first
CREATE INDEX idx_notifications_student_unread_time
  ON notifications (student_id, is_read, created_at DESC);

-- Filter by type (Stage 3 placement query, analytics)
CREATE INDEX idx_notifications_type_time
  ON notifications (type, created_at DESC);
```

### SQL Queries for Stage 1 APIs

```sql
-- GET /notifications?read=false (student 1042)
SELECT id, type, title, message, is_read, created_at
FROM notifications
WHERE student_id = 1042 AND is_read = false
ORDER BY created_at DESC
LIMIT 20 OFFSET 0;

-- PATCH /notifications/:id/read
UPDATE notifications
SET is_read = true
WHERE id = $1 AND student_id = $2
RETURNING *;

-- GET /notifications/unread-count
SELECT COUNT(*) AS count
FROM notifications
WHERE student_id = $1 AND is_read = false;

-- POST /notifications (mass insert — see Stage 5)
INSERT INTO notifications (student_id, type, title, message)
VALUES ($1, $2, $3, $4)
RETURNING id, created_at;
```

### Scaling Issues and Solutions

| Problem | Solution |
|---------|----------|
| Table grows to billions of rows | Range-partition by `created_at` (monthly partitions) — old partitions archived or dropped |
| Hot student IDs on single shard | Shard by `student_id % N` across N Postgres instances |
| Read-heavy dashboard queries | Read replicas with streaming replication; route GET traffic to replicas |
| Write bottleneck for mass notify | Batch `INSERT` with `COPY` command; queue-driven async writes |
| `COUNT(*)` is slow on large tables | Maintain a `notification_counts` summary table, increment via trigger |

### Partitioning Strategy

```sql
CREATE TABLE notifications (
  id          UUID,
  student_id  BIGINT,
  type        notification_type,
  message     TEXT,
  is_read     BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL
) PARTITION BY RANGE (created_at);

CREATE TABLE notifications_2026_04 PARTITION OF notifications
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');

CREATE TABLE notifications_2026_05 PARTITION OF notifications
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
```

Queries automatically prune irrelevant partitions. Old partitions can be detached and archived to cold storage.

---

# Stage 3

## Query Optimization

### Given Query

```sql
SELECT * FROM notifications
WHERE studentID = 1042 AND isRead = false
ORDER BY createdAt DESC;
```

### Is It Accurate?

Functionally correct — returns unread notifications for student 1042 in reverse-chronological order. However it has correctness problems in production:
- `SELECT *` returns all columns including large `message` text blobs, wasting bandwidth
- No `LIMIT` — returns unbounded rows (a student with 10,000 notifications returns all of them)

### Why Is It Slow?

Without the composite index, Postgres performs a **sequential scan** of the entire `notifications` table:
1. Read every row from disk (I/O bound on large tables)
2. Filter rows where `studentID = 1042` (CPU: evaluate predicate on every row)
3. Filter again for `isRead = false` (second pass or in-line)
4. Sort all matching rows by `createdAt DESC` (sort in temp memory or disk if large)

On a table with 10 million rows, even if only 50 belong to student 1042, Postgres reads all 10 million rows before finding them.

### Computational Cost

| Step | Cost |
|------|------|
| Sequential scan | O(N) — full table read |
| Filter predicate | O(N) comparisons |
| Sort | O(K log K) where K = matching rows |
| **Total** | O(N) dominated by full scan |

With the composite index `(studentID, isRead, createdAt DESC)`:
- B-tree lookup by `studentID + isRead` → O(log N)
- Index already ordered by `createdAt DESC` → sort eliminated (Index Scan Backward)
- Only K rows fetched from heap → O(K)
- **Total: O(log N + K)** — orders of magnitude faster

### Why Indexing Every Column Is Bad

| Concern | Detail |
|---------|--------|
| **Write amplification** | Every `INSERT`/`UPDATE`/`DELETE` must update every index. 10 indexes = 10x write overhead. |
| **Storage** | Each index is a full B-tree copy of the indexed column. 10 indexes ≈ 10× extra disk. |
| **Vacuum overhead** | Postgres VACUUM must clean dead tuples in every index — proportional to index count. |
| **Query planner confusion** | Too many indexes force the planner to evaluate more execution plans, slowing planning time. |
| **Rarely used** | A column queried alone without the right selectivity won't be used anyway — wasted space. |

**Rule:** Index only columns that appear in `WHERE`, `ORDER BY`, or `JOIN ON` clauses in frequent queries, in the order they are used.

### Query: Students with Placement Notification in Last 7 Days

```sql
SELECT DISTINCT student_id
FROM notifications
WHERE type = 'Placement'
  AND created_at >= NOW() - INTERVAL '7 days';
```

With the `idx_notifications_type_time` index on `(type, created_at DESC)`, Postgres performs an index range scan — no full table read. `DISTINCT` collapses duplicates (a student may have multiple placements in 7 days).

---

# Stage 4

## Performance Improvements

### Problem
- Notifications fetched on every page load → DB hit on every request
- DB overloaded with repeated identical queries

### Solutions

#### 1. Redis Caching (Per-Student Unread List)

```
GET /notifications?read=false
  → check Redis key: notifs:unread:{studentId}
  → HIT: return cached JSON (TTL: 30s)
  → MISS: query Postgres → store in Redis → return
```

On `mark_as_read` or new notification → `DEL notifs:unread:{studentId}` (cache invalidation).

**Tradeoff:** 30s stale window. Acceptable for notifications; unacceptable for payments.

#### 2. Cursor-Based Pagination

```
GET /notifications?cursor=<last_created_at>&limit=20

SELECT * FROM notifications
WHERE student_id = $1 AND created_at < $cursor
ORDER BY created_at DESC LIMIT 20;
```

**Why cursor over OFFSET:** `OFFSET N` requires Postgres to scan and discard N rows. Cursor jumps directly via the index. At page 500 with limit 20, `OFFSET 10000` scans 10,020 rows; cursor scans 20.

#### 3. SSE / WebSocket Push Instead of Polling

Replace client polling (`setInterval → GET /notifications`) with a persistent SSE connection. Server pushes new notifications as they arrive — zero redundant DB hits between events.

**Polling problem:** 1000 students polling every 5s = 200 req/s of empty responses hitting the DB.
**SSE solution:** 1000 persistent connections, 0 DB hits when nothing changed.

#### 4. Redis Pub/Sub for SSE Fan-Out

```
New notification inserted
  → Service publishes to Redis channel: notifs:{studentId}
  → SSE handler subscribed to that channel
  → Immediately pushes event to connected client
```

No polling. Sub-100ms delivery. Horizontally scalable (any SSE server instance receives the Redis message).

#### 5. Denormalization: Unread Count Cache

Instead of `SELECT COUNT(*) WHERE is_read = false` on every request:
```sql
CREATE TABLE notification_counts (
  student_id  BIGINT PRIMARY KEY,
  unread      INT    NOT NULL DEFAULT 0
);
-- Increment on INSERT, decrement on mark_as_read (via trigger or application logic)
```

**Tradeoff:** Read `O(1)` lookup. Write requires two updates (notifications + counts). Risk of counter drift on failed transactions — fix with periodic reconciliation job.

#### 6. Read Replicas

Route all `GET` traffic to a read replica; only `POST/PATCH/DELETE` hit the primary. Postgres streaming replication lag is typically <1s — acceptable for notifications.

#### 7. CDN for Static Assets

Static notification icons, sounds, and templates served from CDN edge (e.g., CloudFront). Reduces origin load. Not applicable to dynamic notification data.

### Tradeoff Summary

| Strategy | Latency Gain | Complexity | Consistency Risk |
|----------|-------------|------------|-----------------|
| Redis cache | High | Medium | Stale up to TTL |
| Cursor pagination | Medium | Low | None |
| SSE push | Very high | High | None |
| Denormalized count | High | Medium | Counter drift |
| Read replicas | Medium | Medium | Replication lag |

---

# Stage 5

## Reliable Mass Notification Architecture

### Given Pseudocode

```
function notify_all(student_ids, message):
    for student_id in student_ids:
        send_email(student_id, message)
        save_to_db(student_id, message)
        push_to_app(student_id, message)
```

### Shortcomings

| Problem | Detail |
|---------|--------|
| **Synchronous serial loop** | 10,000 students × 3 operations = 30,000 sequential I/O calls. At 50ms each → 25 minutes. The caller blocks the entire time. |
| **No failure handling** | If `send_email` throws on student #201, the entire function crashes. Students 202–10,000 receive nothing. |
| **No idempotency** | On retry, `save_to_db` inserts duplicates. Students get duplicate DB records and duplicate push notifications. |
| **No retry logic** | Transient SMTP or push network errors cause permanent failure with no recovery. |
| **No partial-failure recovery** | No way to know which students succeeded vs failed after a crash midway. |
| **Tight coupling** | Email, DB, and push are in the same transaction boundary. A slow email provider blocks DB writes. |
| **No backpressure** | All 10,000 emails dispatched simultaneously — could exhaust SMTP connection pool or get rate-limited. |

### The Partial Failure Problem: 200 Emails Failed Midway

`send_email` failed starting at student #201. We now have:
- Students 1–200: email sent ✓, saved to DB ✓, push sent ✓
- Students 201–10,000: nothing done

**Without idempotency:** Retrying from scratch re-sends to students 1–200 (duplicate emails).
**Solution:** An idempotency key per `(studentId, notificationId)` pair:
- Before sending, check if `notification_sends(student_id, notification_id, channel)` already has `status = 'sent'`
- If yes: skip. If no (or `status = 'failed'`): send and update status.

This makes the entire operation safe to retry from any point.

### Redesigned Architecture

```
notify_all(student_ids, message)
    │
    ▼
Generate notification_id (UUID)
    │
    ▼
Bulk insert into notifications table (student_id, notification_id, status='pending')
    │
    ▼
Publish events to Message Queue (one message per student)
    │
    [Returns immediately — caller not blocked]
    │
    ▼  (async workers)
┌─────────────────────────────────────────────────────────┐
│  Worker Pool (N consumers from queue)                   │
│                                                          │
│  For each message:                                       │
│    1. Idempotency check: skip if already 'sent'         │
│    2. send_email()   → on failure: NACK → retry queue   │
│    3. push_to_app()  → on failure: NACK → retry queue   │
│    4. UPDATE status = 'sent' in DB                      │
│                                                          │
│  Max retries exceeded → Dead Letter Queue (DLQ)         │
└─────────────────────────────────────────────────────────┘
    │
    ▼
DLQ consumer:
  - Alert ops team
  - Store failed student_ids for manual review / re-send
```

**Key components:**
- **Message Queue** (RabbitMQ / SQS / Kafka): decouples producer from consumers, enables backpressure
- **Idempotency table** `notification_sends(student_id, notification_id, channel, status, attempts)`: prevents duplicates on retry
- **Dead Letter Queue**: captures permanently failed deliveries for manual intervention
- **Batch DB inserts**: bulk insert all `pending` records before queueing — DB is source of truth even before delivery
- **Exponential backoff**: retry delay = `min(2^attempt × 100ms + jitter, 30s)`

### Revised Pseudocode

```python
function notify_all(student_ids, message):
    notification_id = generate_uuid()
    
    # Bulk write all pending records atomically
    bulk_insert_notification_sends(
        [{ student_id, notification_id, status: "pending" } for student_id in student_ids]
    )
    
    # Enqueue one message per student (non-blocking)
    for student_id in student_ids:
        enqueue("notification_jobs", {
            student_id: student_id,
            notification_id: notification_id,
            message: message
        })
    
    return { notification_id, queued: len(student_ids) }


# Async worker (runs N instances in parallel)
function process_notification_job(job):
    { student_id, notification_id, message } = job
    
    # Idempotency guard
    record = get_send_record(student_id, notification_id)
    if record.status == "sent":
        ack(job)
        return
    
    try:
        send_email(student_id, message)
        push_to_app(student_id, message)
        update_status(student_id, notification_id, "sent")
        ack(job)
    except TransientError as e:
        if record.attempts < MAX_RETRIES:
            nack(job, delay=backoff(record.attempts))  # requeue with delay
        else:
            move_to_dlq(job, reason=str(e))
            update_status(student_id, notification_id, "failed")
            ack(job)


# DLQ consumer
function process_dlq(job):
    alert_ops(job)
    log_permanent_failure(job)
    # Optionally: store in failed_notifications table for admin retry UI
```

---

# Stage 6

## Priority Inbox Implementation

### Endpoint

```
GET /notifications/priority?n=10
Authorization: Bearer <token>
```

### Scoring Formula

Importance is a function of **type weight** and **recency**:

```
priority_score = type_weight × 1000 / (1 + age_in_hours)
```

| Type | Weight |
|------|--------|
| Placement | 3 |
| Result | 2 |
| Event | 1 |

A fresh Placement scores `3000 / 1 = 3000`. A Placement from 24 hours ago scores `3000 / 25 = 120`. A fresh Event scores `1000 / 1 = 1000`. This means type weight dominates for recent notifications, but an extremely old Placement can be outranked by a fresh Event — recency matters.

### Implementation

The actual code lives in the running service at `notification_app_be/src/`:

**`services/notification.service.ts`** — scoring + sorting:
```typescript
const TYPE_WEIGHTS: Record<string, number> = { Placement: 3, Result: 2, Event: 1 };

function priorityScore(n: EvalNotification): number {
  const ageHours = (Date.now() - new Date(n.Timestamp).getTime()) / 3_600_000;
  return (TYPE_WEIGHTS[n.Type] ?? 0) * 1000 / (1 + ageHours);
}

export const getPriorityInbox = async (count: number): Promise<EvalNotification[]> => {
  const all = await fetchExternalNotifications();
  return all
    .map((notif) => ({ notif, score: priorityScore(notif) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .map(({ notif }) => notif);
};
```

**`routes/notification.route.ts`** — endpoint registration:
```typescript
.get("/priority", getPriorityInboxHandler, {
  query: t.Object({ n: t.Optional(t.String()) }),
})
```

### How to Maintain Top 10 Efficiently as New Notifications Arrive

Fetching all and sorting is fine for batch requests (`O(M log M)`). For a live streaming scenario where notifications arrive one at a time, a **min-heap of size N** is optimal:

```
Algorithm: Online Top-N with Min-Heap

Initialize: minHeap = [] (size 0)

For each incoming notification n:
  score = priorityScore(n)

  if heap.size < N:
    heap.push(n, score)          # heap not full yet — always add

  else if score > heap.peek().score:
    heap.pop()                   # evict lowest-priority item
    heap.push(n, score)          # insert new higher-priority item

  # else: score ≤ min in heap → discard, not in top N

Result: heap contains top N notifications at all times
```

**Complexity:**
- Per notification: `O(log N)` heap operations
- After M notifications: `O(M log N)` total
- Space: `O(N)` — only top N stored in memory at any point

Compare to sort-all: `O(M log M)` time, `O(M)` space — much worse when M ≫ N.

A min-heap ensures that the lowest-priority item in the top N is always at the root, making the "should I evict?" check `O(1)` and the evict+insert `O(log N)`.
