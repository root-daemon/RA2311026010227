# Campus Notifications Microservice — System Design & Engineering Proposal

This document captures an end‑to‑end design for a **Campus Notifications** platform: REST and real‑time APIs, persistence, scaling, reliability, and priority inbox semantics. It is written as implementation‑ready architecture (Stages 1–6), with assumptions, operational concerns, and security called out explicitly.

---

⸻

## Stage 1 — API Design

### System overview

The **Campus Notifications Microservice** is the dedicated boundary for delivering time‑sensitive, student‑scoped messages (placement drives, academic results, campus events). It sits behind an **API Gateway** (auth termination, rate limits, TLS) and coordinates with identity services, outbound channels (email/push/mobile), and a **delivery pipeline** (queue + workers) for blast sends.

High‑level responsibilities:

1. **Ingest**: accept notification creation for one student or many (campaigns).
2. **Serve**: paginated reads, filters, unread counts, priority inbox (Stage 6).
3. **Real‑time**: push new items to connected clients without aggressive polling.

Text diagram — request path:

```
Client → API Gateway (HTTPS, JWT) → Notification Service → PostgreSQL / Redis / Queue
                                                      ↘ SSE/WebSocket Adapter
                                                      ↘ Workers → Email / Push / Mobile
```

### REST API endpoints

Base path: `/notifications` (versioned externally as `/v1/notifications` if required by the gateway).

| Method | Path | Purpose |
|--------|------|--------|
| `GET` | `/notifications` | List notifications for the authenticated student with optional filters and pagination. |
| `GET` | `/notifications/:id` | Fetch a single notification by id (ownership enforced). |
| `POST` | `/notifications` | **Admin/internal**: create notification for student(s)*; returns created resource or job id for bulk. |
| `PATCH` | `/notifications/:id/read` | Mark one notification read (idempotent). |
| `POST` | `/notifications/read-batch` | Mark many ids read in one transaction. |
| `GET` | `/notifications/unread-count` | O(1) or cached count of unread items. |
| `POST` | `/internal/notify` | **Trusted**: enqueue “notify users” campaign (targets + payload); returns `notification_batch_id`. |
| `GET` | `/notifications/priority` | Top‑N scored inbox (Stage 6). |

*Production pattern: `/internal/notify` for mass sends; `POST /notifications` for single‑recipient or low‑volume admin tools.*

**Filter/query parameters on `GET /notifications`:**

| Parameter | Example | Description |
|-----------|---------|-------------|
| `read` | `true` \| `false` | Filter by read state (join to `notification_reads`). |
| `type` | `Placement` \| `Result` \| `Event` | Filter by notification category. |
| `since` | ISO 8601 | Only notifications at or after timestamp. |
| `cursor` | opaque | Cursor‑based pagination (Stage 4). |
| `limit` | default 20, max 100 | Page size. |

### Request / response schemas (illustrative JSON)

**`POST /notifications` (single create)**

```http
POST /notifications HTTP/1.1
Content-Type: application/json
Authorization: Bearer <jwt>
Idempotency-Key: <optional-uuid>
```

```json
{
  "studentId": 1042,
  "title": "On‑campus: CSX briefing",
  "message": "CSX Corporation — briefing at Hall A, 4pm.",
  "type": "Placement",
  "metadata": { "source": "cdc_portal", "campaignId": "cmp_01" }
}
```

```json
{
  "id": "8b2c…",
  "studentId": 1042,
  "title": "On‑campus: CSX briefing",
  "message": "CSX Corporation — briefing at Hall A, 4pm.",
  "type": "Placement",
  "read": false,
  "createdAt": "2026-05-02T10:15:30.000Z"
}
```

**`GET /notifications?read=false&type=Placement&limit=20`**

```json
{
  "notifications": [
    {
      "id": "8b2c…",
      "title": "…",
      "message": "…",
      "type": "Placement",
      "read": false,
      "createdAt": "2026-05-02T10:15:30.000Z"
    }
  ],
  "nextCursor": "eyJjcmVhdGVkQXQiOiIuLiJ9",
  "hasMore": true
}
```

**`PATCH /notifications/:id/read`**

Response `200`:

```json
{
  "id": "8b2c…",
  "read": true,
  "readAt": "2026-05-02T11:00:01.123Z"
}
```

**`GET /notifications/unread-count`**

```json
{ "count": 7 }
```

**`POST /internal/notify`** (trusted service‑to‑service)

```json
{
  "studentIds": [1042, 1043, …],
  "title": "Fee payment deadline",
  "message": "…",
  "type": "Event",
  "channels": ["in_app", "email"]
}
```

```json
{
  "batchId": "nbatch_…",
  "accepted": 9821,
  "status": "queued"
}
```

### Headers

| Header | When required | Meaning |
|--------|----------------|--------|
| `Authorization: Bearer <JWT>` | Authenticated reads/writes | Student or service identity claims (`sub`, `student_id`, `roles`). |
| `Content-Type: application/json` | Bodies present | Serialization. |
| `Accept: application/json` | Preferred | Negotiation (`application/json` or `text/event-stream` for stream). |
| `Idempotency-Key` | Safe retries | Deduplicates `POST` duplicate submissions (paired with TTL store). |

### Authentication flow

1. Client obtains JWT from campus IdP / OAuth device flow.
2. **API Gateway** validates signature, expiry, issuer, audience; injects forwarded identity headers if needed internally.
3. **Notification Service** resolves `student_id` from JWT `sub`/claim; denies cross‑tenant access (cannot read another student’s `:id`).
4. **Internal** routes (`/internal/*`) use **mTLS + service JWT** or **signed gateway headers**, not browser tokens.

Diagram:

```
[Client] → login → [IdP] → access_token (JWT)
[Client] → GET /notifications (Authorization: Bearer …)
           → [Gateway verifies JWT]
           → [Notification Service] scopes queries to student_id from claims
```

### Real‑time notification mechanism

**Mechanism**: **Server‑Sent Events (SSE)** on `GET /notifications/stream` for default campus web clients.

- **SSE** uses one long‑lived HTTP response (`Content-Type: text/event-stream`), automatic browser reconnect, standard HTTP infra (proxies/ALBs), server→client direction only — ideal for notification fan‑out.
- **WebSocket** (`wss://…/notifications/ws`) suits mobile or bidirectional needs (heartbeat, ACK, collaborative features).

### WebSocket vs SSE — comparison and choice

| Aspect | SSE | WebSocket |
|--------|-----|-----------|
| Direction | Primarily server → client | Bidirectional |
| Transport | HTTP/1.1 or HTTP/2 | Dedicated upgrade |
| Reconnect | Built‑in (`Last-Event-ID`) | App must implement |
| Proxies/CDN | Straightforward HTTP | Occasionally trickier ops |
| Binary payload | Limited | Efficient |

**Choice for campus web inbox:** **SSE** as the primary channel: notifications are overwhelmingly **push‑only**, operational complexity stays low, horizontal scale is handled by subscribing each app instance to a **Redis Pub/Sub** or **broker** topic keyed by student.

Text flow:

```
PostgreSQL INSERT → Publisher → Redis channel notif:{studentId}
       → SSE process subscribed → flush `event: notification` to client's stream
```

If native apps later require ACK or typing indicators, expose **WebSocket** alongside SSE.

---

⸻

## Stage 2 — Database Design

### Chosen DB: PostgreSQL

**PostgreSQL** is the relational store because:

- **ACID transactions** unify “record exists + enqueue event” semantics for reliable delivery initiation.
- **Strong constraints** (`FOREIGN KEY`, check constraints, enums) preserve data hygiene at scale.
- **JSONB** allows optional structured `metadata` without schema churn.
- **Mature tooling**: partitioning declarative DDL, streaming **read replicas**, **LISTEN/NOTIFY** for low‑latency internal signals (still pair with Kafka/SQS for cross‑AZ durability in production).

NoSQL alternatives are viable at extreme fan‑out archival tiers but add complexity for transactional read/unread correctness and analytical joins; Postgres remains the pragmatic default here.

### Schema design

**Design principle:** Notifications are treated as **immutable content** once written (corrections = new notification). **Read state** lives in **`notification_reads`** to avoid rewriting hot rows on every open.

```sql
CREATE TYPE notification_type AS ENUM ('Placement', 'Result', 'Event');

CREATE TABLE students (
  student_id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  name       TEXT NOT NULL,
  email      TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id  BIGINT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
  type        notification_type NOT NULL,
  title       TEXT NOT NULL,
  message     TEXT NOT NULL,
  metadata    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT title_nonempty CHECK (char_length(title) > 0),
  CONSTRAINT message_nonempty CHECK (char_length(message) > 0)
);

CREATE TABLE notification_reads (
  student_id      BIGINT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
  notification_id UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  read_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, notification_id)
);
```

### Relationships

- `students (1) — (N) notifications` — each notification row belongs to one student.
- `notifications` (1) — (0..1) `notification_reads` per `(student_id, notification_id)` — absence of row ⇒ unread.

Unread query pattern:

```sql
SELECT n.*
FROM notifications n
LEFT JOIN notification_reads nr
  ON nr.notification_id = n.id AND nr.student_id = n.student_id
WHERE n.student_id = $student
  AND nr.notification_id IS NULL;
```

*(Alternatively store `notifications.student_id` as redundant join key consistently; PK on reads already ties student + notification.)*

### Indexes

```sql
-- Feed: student’s inbox newest first (covers read filter via semi-join planner)
CREATE INDEX idx_notifications_student_created
  ON notifications (student_id, created_at DESC);

-- Type + recency analytics / Stage 3 placement slice
CREATE INDEX idx_notifications_type_created
  ON notifications (type, created_at DESC);

-- Mark-read lookups and FK support
CREATE INDEX idx_reads_notification ON notification_reads (notification_id);
```

Consider **partial index** if “unread only” dominates:

```sql
-- Optional helper: maintain only unread pointer table in some designs — here we keep reads sparse.
```

For **high read volume**, a **materialized unread count per student** (denormalized) can be maintained by trigger or nightly reconcile (tradeoff vs write amplification).

### Scaling issues & mitigations

| Pressure | Risk | Mitigation |
|----------|------|-------------|
| Table growth | Long sequential scans | **Range partitioning** on `notifications.created_at` |
| Hot rows on dominant `student_id` | Uneven shard keys | Shard by hashed `student_id` if multi‑tenant cluster |
| Read storms | Replica lag | Cache hot lists Redis; prioritize **SSE push** vs pull |
| Write spikes | WAL/insert path | Bulk `COPY`; async fan‑out queue |
| Heavy `COUNT(*)` | Expensive aggregates | Maintain **counter row** per student |

### Partitioning

Monthly (or weekly) declarative partitions on `notifications`; **prune old partitions** to cold storage. Primary key and indexes must align with partition key strategy (common choice: PK `(created_at, id)` or composite aligning with partitioning — requires careful migration in real deployments).

### Read replicas & caching ideas

- **Streaming replication replica** serves `GET /notifications`, `priority`, dashboards; writes go to primary only.
- **Redis**: cache assembled first page `{student}:feed:v1`; invalidate on insert or mark‑read pattern (Stage 4).
- **Stale reads**: Replica lag is tolerated for inbox (seconds); mark‑read and **unread_count** ideally read **recent primary** or use counter table.

### SQL queries backing Stage 1 APIs

```sql
-- GET /notifications?read=false&limit=21 (cursor optional)
SELECT n.id, n.type, n.title, n.message, n.metadata, n.created_at,
       (nr.notification_id IS NOT NULL) AS read
FROM notifications n
LEFT JOIN notification_reads nr
  ON nr.notification_id = n.id AND nr.student_id = n.student_id
WHERE n.student_id = $student
  AND ($read_filter IS NULL OR ($read_filter = true AND nr.notification_id IS NOT NULL)
                             OR ($read_filter = false AND nr.notification_id IS NULL))
ORDER BY n.created_at DESC
LIMIT $limit;

-- PATCH /notifications/:id/read — idempotent
INSERT INTO notification_reads (student_id, notification_id)
VALUES ($student, $id)
ON CONFLICT (student_id, notification_id) DO NOTHING;

-- GET unread count
SELECT COUNT(*) AS count
FROM notifications n
LEFT JOIN notification_reads nr
  ON nr.notification_id = n.id AND nr.student_id = n.student_id
WHERE n.student_id = $student AND nr.notification_id IS NULL;

-- POST /notifications (single row + optional enqueue side effect in app layer)
INSERT INTO notifications (student_id, type, title, message, metadata)
VALUES ($student, $type::notification_type, $title, $message, $metadata::jsonb)
RETURNING *;

-- POST /internal/notify — transactional bulk rows + publish (app commits then enqueues)
INSERT INTO notifications (student_id, type, title, message)
SELECT unnest($student_ids), $type::notification_type, $title, $message;
```

---

⸻

## Stage 3 — Query Optimization

### Why the naive query is slow

Consider:

```sql
SELECT *
FROM notifications
WHERE student_id = 1042
  AND is_read = false   -- illustrative if read were a column (see normalization above)
ORDER BY created_at DESC;
```

Without a selective index aligned to **filter + sort**, PostgreSQL tends toward **sequential scan + sort**:

- **`SELECT *`** pulls fat columns (`message`, metadata) unnecessarily.
- Large result sets force **expensive sorts** (`O(K log K)` rows after filter).
- Unbounded pagination loads **millions** of stale rows nobody scrolls past.

Computational dominance: **full relation scan O(N)** on `notifications`; index‑only plans reduce to **`O(log N + K)`** with proper B‑tree composite alignment.

### Indexing strategy & composite indexes

Build composites to match **equality predicates left‑to‑right**, then **range/order**:

- **`(student_id, created_at DESC)`** feeds “my feed newest first”.
- **`(type, created_at DESC)`** feeds global analytics (Stage 3 placement cohort query).

Avoid duplicating unrelated low‑cardinalityLeading columns ahead of selective ones (planner chooses wrong scans).

### Why indexing every column is bad

- **Write amplification**: every index must be maintained on INSERT/UPDATE/DELETE.
- **Disk & cache pressure**: oversized index set evicts hot pages earlier.
- **Vacuum/autoanalyze cost** scales with index cardinality.
- **Planner time** increases (more candidate paths).
**Rule**: index **proven critical paths** measured in production traces; add **hypothetical‑index tooling** (`pg_hypo`) load tests before shipping.

### Optimized listing query

```sql
SELECT n.id, n.type, n.title,
       LEFT(n.message, 280) AS preview,
       n.created_at
FROM notifications n
LEFT JOIN notification_reads nr
  ON nr.student_id = n.student_id AND nr.notification_id = n.id
WHERE n.student_id = $1
  AND nr.notification_id IS NULL
ORDER BY n.created_at DESC
LIMIT $2;
```

**Index:** `notifications (student_id, created_at DESC)` plus efficient join on the `notification_reads` primary key `(student_id, notification_id)`.

### “Placement notifications” analytical query

```sql
SELECT DISTINCT n.student_id
FROM notifications n
WHERE n.type = 'Placement'
  AND n.created_at >= now() - interval '7 days';
```

Uses **`idx_notifications_type_created`** for range‑bounded index scan rather than sequential read of full history.

---

⸻

## Stage 4 — Scaling & Performance

### Redis caching

Cache **serialized first page + unread_total** keyed by `$student`:

```
GET → Redis HIT → return
MISS → Postgres + assemble → SETEX 30s
```

Invalidate on **`INSERT`** for that student and **`mark‑read`** (delete key). **Tradeoff**: brief staleness acceptable for inbox; unacceptable for ledger systems.

### Pagination

- **Offset** (`OFFSET 500 * 20`): database discards scanned rows ⇒ cost grows linearly with page depth.
- **Cursor** (**recommended**): `WHERE created_at < $cursor` + `LIMIT` leverages index order.

### Cursor‑based pagination (example contract)

```
GET /notifications?limit=20&cursor=opaque
```

opaque encodes `{ created_at, id }` for deterministic tie‑break under identical timestamps.

### Polling vs WebSockets vs SSE baseline

Polling at high QPS ⇒ **Thundering herd** hitting DB/cache. Maintain **SSE/WebSocket subscriptions** scaled by Redis Pub/Sub or broker-backed fan‑out. **Tradeoff**: connection memory / sticky routing complexity vs thundering herds.

### Batching

- **Produce**: batch enqueue `notify` publishes.
- **Consume**: workers prefetch N messages respecting downstream rate limits (**token bucket**) for SMTP/APNs.


### CDN

CDN serves **avatars, attachments, static banners** bundled in rich notifications—not dynamic JSON payloads. **Tradeoff**: cache invalidation for rapidly changing creatives.

### Read replicas / denormalization

Replicas offload **read paths** — accept replica lag SLA. Denormalized `unread_count` row **slashes read cost** yet requires careful transactional increments—**tradeoff** consistency complexity vs lightning `GET unread-count`.

**Summary tradeoffs:**

| Technique | Wins | Pays |
|-----------|------|------|
| Redis cache | latency, DB shielding | staleness TTL |
| Cursor pagination | predictable latency | UX for random page jumps harder |
| Push channels | minimizes idle reads | infra & connection cost |
| Denorm counters | ultra-fast counts | invariant bugs if unsync'd |
| Replicas | read scale | staleness semantics |

---

⸻

## Stage 5 — Reliable Notification Architecture

### Flaws in a naive synchronous implementation

```text
function notify_all(student_ids, message):
    for student_id in student_ids:
        send_email(student_id, message)
        save_to_db(student_id, message)
        push_to_app(student_id, message)
```

Problems: **serialized latency explosion**, single failure kills tail progress, partial success **ambiguous**, **duplicate side effects on retry**, no **rate limiting/backpressure**, no **delivery audit trail**.

### Queue‑based architecture

Insert canonical rows (**source of truth**), publish **immutable events** referencing `notification_id` and routing key `student_id` to Kafka, SQS, or RabbitMQ. **Workers** horizontally scale outbound I/O.

Architecture sketch:

```
┌──────────────────┐     bulk insert       ┌─────────────┐
│ Admin / Campaign │ ─────────────────────► │ PostgreSQL  │
└────────┬─────────┘                         └──────▲──────┘
         │ enqueue                                │ status
         ▼                                          │
┌──────────────────┐   consume/work         ┌───────┴───────┐
│ Message Queue    │ ─────────────────────► │ Worker Pool │
└────────┬─────────┘                         └───┬───┬─────┘
         │ retries / DLQ                          │   │
         ▼                                           │   │
┌──────────────────┐                                   │   └─► Push / SSE bridge
│ Dead-letter Q    ◄─────────────────── failures Nx   │
└──────────────────┘                                   └────► SMTP / SES
```

### Retries & dead‑letter queues (DLQ)

- **Transient** errors (SMTP 4xx timeouts, downstream 503): exponential backoff **`2^n * base + jitter`**, capped; requeue limited attempts.
- **Permanent** failures (invalid email): **immediate DLQ** with diagnostic payload **without endless retry noise**.

### Async workers & event‑driven design

Orchestration is **event‑driven**: campaign accepted → partitioned topics by `shard(student_id)` for ordered per‑student processing.**Competing consumers** improve throughput.**Idempotent consumers** reconcile with DB state.


### Idempotency

Declare a unique constraint on `(delivery_id, channel, recipient)` surface, or support HTTP **`Idempotency-Key`** for producers. Carry a stable **`notification_batch_id`** and student identifier through queue messages so replays remain safe.

### Revised pseudocode

```pseudo
FUNCTION notify_campaign(student_ids[], payload):
    batch_id = uuid()
    TX BEGIN
        INSERT notification_batches (...) VALUES (batch_id, ...)
        INSERT INTO notifications (student_id, title, message, type, batch_id)
          SELECT unnest(student_ids), payload.title, payload.message, payload.type, batch_id
    TX COMMIT

    PARALLEL FOR EACH student_id IN student_ids:
        enqueue("deliver.notification", {
            batch_id,
            student_id,
            dedupe_key: hash(batch_id, student_id)
        })

    RETURN { batch_id, queued: len(student_ids) }


WORKER on message m:
    IF delivery_record_exists(m.dedupe_key):
        ACK; RETURN

    TRY:
        IF "email" IN channels: send_email(m)
        IF "push" IN channels: send_push(m)
        IF "sse" IN channels: publish_realtime_fanout(m.student_id)
        mark_delivered(m.dedupe_key)
        ACK
    CATCH transient_error AS e:
        IF attempts++ < MAX: NACK(delay=backoff(attempts))
        ELSE: publish(DLQ, m + error_context); ACK
```

---

⸻

## Stage 6 — Priority Inbox

Goal: **`GET /notifications/priority?n=10`** returns the **best** N items blending **semantic importance** and **recency** without sorting all historic rows whenever possible.


### Scoring logic

Example multiplicative/decay model:

```
priority_score(type_weight, age_hours) = type_weight * 1000 / (1 + age_hours)
```

| Type | `type_weight` |
|------|----------------|
| Placement | 3 |
| Result | 2 |
| Event | 1 |

**Recency weighting**: the divisor `(1 + age_hours)` dampens stale items nonlinearly—young Placement still outranks old Placement unless age dominates.

### Priority calculation variants

Tune with floors/ceilings: `max(score_floor, weighted - λ * sqrt(age))` introduces stability for governance (e.g. regulatory alerts never drop below baseline).

### Maintaining **top N** efficiently

Streaming arrivals use a **min‑heap keyed by computed score**:

1. Maintain heap size ≤ **N**.
2. For each arriving item compute **score**.
3. If `heap.size < N` → insert.
4. Else if `score > heap.min.score` → **pop min**, insert new.
5. Else discard.


**Complexity**: per insertion **`O(log N)`** vs full sort **`O(M log M)`** over **M_total** backlog.

Alternatively DB query with **indexed recency cutoff** + **`ORDER BY score_expr LIMIT N`** leverages partial evaluation when **M_recent << M_history**.

Handling **new notifications**: push into heap if qualifies; optionally **persist materialized ordering** ephemeral (no long-term duplication of truth).

```
Min-Heap invariant: smallest score at root (among top-N candidates tracked)
incoming score > root → replace root → heapify → O(log N)
```

---

⸻

## Architecture diagrams (compact reference)

### API flow

```
Mobile/Web → HTTPS → Gateway (JWT,rates) → Service → Postgres
                                               ↘ Redis Pub/Sub → SSE
```

### End‑to‑end notification flow

```
Create → Persist → Publish → Worker(s) Channel dispatch → Receipt logs
                        ↘ Realtime fan‑out adapter
```

### Queue architecture & WebSocket/SSE adaptor

```
[API] ─ enqueue ─► [Queue] ─► [Workers] ─► providers
                                   │
                                   └──► SSE hub / WS gateway (fan-out)
```


---

## Assumptions

1. Notification **content rows are immutable** after insert; substantive edits spawn a successor record.
2. **Unread/read** derives from **`notification_reads`** existence (sparse table).
3. **Peak concurrent SSE** connections ≈ **15–25% daily active users** intermittently—not full enrollment simultaneously (dimension connection pools accordingly).
4. **Clock skew bounded** (<1s); priority scoring tolerant to minor drift.
5. Replica **lag SLA** `< 2 seconds` acceptable for inbox listing (not banking ledger).

---


## Error handling

| Layer | Behavior |
|-------|----------|
| **API validation** | 400/422 deterministic JSON problem details; reject oversize payloads. |
| **Auth** | `401` for stale or invalid JWT. Prefer uniform `404` for cross‑tenant resource mismatches versus selective `403` where policy dictates an explicit forbidden signal. |
| **Transient downstream** | bounded retries exponential backoff circuits open after failure threshold propagate `503` sparingly expose `retry_after`. |
| **Queue publish failure** | transactionally **hold** outbound row flagged `delivery_state=pending`; reconciler retries. |
| **Worker poison message** | after **N failures** relocate **DLQ** + metric alert. |
| **Timeouts** | client HTTP deadlines; worker processing budgets cancel partial side effects compensated via reconciliation job. |

---

## Security

- **JWT** validation (issuer, audience, expiry, small clock leeway) plus short-lived tokens and rotating keys (JWKS).
- **HTTPS** everywhere external; TLS between internal services preferred.
- **Rate limiting**: per‑IP baseline, stricter quotas per authenticated student, and burst controls on internal blast endpoints.
- **Input validation**: schema constraints on lengths and enums to block oversize payloads and mass-assignment anomalies.
- **Least privilege**: separate DB credentials (read-only replica role for selectors; constrained writer role).
- **Audit**: append-only `notification_batches` lineage for forensic traceability of privileged admin actions.

---


## Document revision

Maintained alongside service implementation increments; Breaking API changes gated through versioned routing (`v1`,`v2`).
