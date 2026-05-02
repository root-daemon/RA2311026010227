# Vehicle Maintenance Scheduler

Engineering README for the **Vehicle Maintenance Scheduler** microservice — a small HTTP service that retrieves fleet maintenance **tasks** and **depot** capacity constraints from an external evaluation API and returns **optimized schedules** per depot using a classical **dynamic programming knapsack** formulation.

---

## Problem statement

The operations team must decide **which maintenance tasks to perform** across depots subject to finite **mechanic-hours** budgets at each site. Each task consumes a duration (hours) and delivers a quantitative **impact** score (priority / business value objective).

Formal model:

| Knapsack role | Scheduling concept |
|---------------|--------------------|
| Item | Maintenance task (`Task`) |
| Weight | Duration in hours (`Duration`) |
| Value | Impact (`Impact`) |
| Capacity | Depot mechanic budget (`MechanicHours`) |

**Objective**: **maximize Σ Impact** subject to **Σ Duration ≤ MechanicHours** for each depot, choosing each candidate task **at most once** per depot run — precisely the **0/1 knapsack** optimization problem.


---

## APIs used

The service integrates with an external **evaluation** HTTP API (`EVAL_BASE_URL`, default aligned with coursework infrastructure). Authentication retries on `401`.

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `${EVAL_BASE_URL}/auth` | `POST` | Obtain / refresh Bearer token (`REGISTER_EMAIL`, `REGISTER_NAME`, `REGISTER_ROLL_NO`, `ACCESS_CODE`, `CLIENT_ID`, `CLIENT_SECRET`). |
| `${EVAL_BASE_URL}/depots` | `GET` | Returns depot records including identifier and **`MechanicHours`** budget (`fetchDepots`). |
| `${EVAL_BASE_URL}/vehicles` | `GET` | Returns vehicle/task list incl. **`TaskID`**, **`Duration`**, **`Impact`** (`fetchVehicles`). |

Client implementation references: `vehicle_maintenance_scheduler/src/api/client.ts`.

**Example truncated JSON shapes (illustrative):**

Depots:

```json
{
  "depots": [
    { "DepotID": 1, "MechanicHours": 120, "..." : "..." },
    { "DepotID": 2, "MechanicHours": 135 }
  ]
}
```

Vehicles/tasks:

```json
{
  "vehicles": [
    { "TaskID": "...", "Duration": 4, "Impact": 7 },
    { "TaskID": "...", "Duration": 6, "Impact": 9 }
  ]
}
```

---


## Optimization approach

The core routine `knapsack(tasks, capacity)` (see `src/utils/knapsack.ts`) builds a DP table:

\[
\text{dp}[i][w] = \max \text{ achievable impact using subset of first } i \text{ tasks with total duration } \le w
\]

Transitions implement the canonical 0/1 choice (skip vs take-if-fits).

**Complexity**:

| | |
|-|-|
| Time | **`O(n · W)`** per depot (`n` tasks, capacity `W` integer hours). |
| Space | **`O(n · W)`** for reconstructing selected multiset via traceback. |

**Why brute force is inadequate**: inspecting all **2^n** subsets for `n ≈ 40` already approaches **one trillion** combinations — astronomical latency.**DP exploits optimal sub-structure** collapsing overlapping subproblems.

**Practical scaling note**: If `MechanicHours` grew very large pseudopolynomial bottleneck emerges; alternative **meet-in-the-middle** or **approximation schemes** emerge only beyond typical operational magnitudes.



---

## Flow

Logical execution path:

```
1. Fetch depots        ──┐
2. Fetch vehicles/tasks └─► Promise.all (parallel I/O minimize wall clock)
3. FOR EACH depot:
        knapsack(allTasks, depot.MechanicHours)
4. RETURN array of depot results OR single depot envelope for /schedule/:depotId
```

Exposed REST routes (`src/routes/schedule.route.ts`):

| Method | Route | Behaviour |
|--------|-------|-----------|
| `GET` | `/schedule/` | Optimize **all depots**. |
| `GET` | `/schedule/:depotId` | Optimize **single depot**; `404` with `availableDepots` if ephemeral ID missing from latest fetch |

Auxiliary cron & vehicle CRUD exist for maintenance monitoring (`src/scheduler/maintenance.cron.ts`, `vehicle` routes).


---

## Complexity analysis (summary)

| Aspect | Complexity | Notes |
|--------|------------|-------|
| **Time** `knapsack` | `Θ(n · W)` | Dominates compute vs network on typical datasets |
| **Space** DP table | `Θ(n · W)` | Trades memory for deterministic optimality |
| **Per HTTP request** | `O(D · n · W)` | `D` depots sequentially optimized (still ms–low seconds at supplied sizes) |


Potential micro-optimization: reuse single DP slab if rewriting for uniform capacities (not implemented — clarity prioritized).


---

## Logging integration

Structured logging leverages workspace package `@local/logging-middleware`:

| Area | Typical log cues |
|------|------------------|
| **HTTP handler** (`handler`) | Depot/vehicle fetch start + counts + failures |
| **Routes** (`route`) | `GET /schedule` invocation |
| **Errors** (`error`) | Upstream HTTP non-OK responses (`Depots API returned …`) |

Each call commonly uses **fire‑and‑forget** `void Log(...)` semantics so instrumentation cannot block scheduling.

Minimal illustrative patterns found in codebase:

```
Fetching depots from evaluation API
Fetched 5 depots
Fetching vehicles from evaluation API
Fetched 37 tasks
```

Destination URL configured via `LOG_API` in environment (defaults align with `.env.example`).


---

## Output screenshots

> **Authoring note:** Screenshots evolve per machine / token / live API payloads. Capture your own artifacts and drop them beside this README — example relative paths:


| Screenshot intent | Proposed asset path |
|-------------------|---------------------|
| Depots HTTP JSON | `./docs/screenshots/depots-response.png` |
| Vehicles/tasks JSON | `./docs/screenshots/vehicles-response.png` |
| `/schedule/` optimized schedule excerpt | `./docs/screenshots/schedule-all.png` |
| `/schedule/:id` single depot | `./docs/screenshots/schedule-depot.png` |
| Structured logger lines (terminal / aggregator) | `./docs/screenshots/logger-output.png` |

Embed after capture:

```markdown
![Depots API](./docs/screenshots/depots-response.png)
![Optimized schedule excerpt](./docs/screenshots/schedule-all.png)
```


---

## Setup instructions

Prerequisites:** [Bun](https://bun.sh)**, network access to evaluation API endpoints.

Installation from monorepo root (workspace linkage for logging package):

```bash
bun install
```

Environment (`vehicle_maintenance_scheduler/.env` — copy `.env.example`):

| Variable | Purpose |
|----------|---------|
| `PORT` | HTTP listen (default implementation uses `3002` in coursework layout) |
| `EVAL_BASE_URL` | Evaluation API prefix |
| `ACCESS_TOKEN` | Initial bearer (optional refresh path uses registration credentials) |
| `REGISTER_EMAIL` / … | Auth refresh handshake |
| `LOG_API` | Centralized logging sink endpoint |

Run:

```bash
cd vehicle_maintenance_scheduler
bun install   # first time inside package if standalone
bun run dev   # hot reload watcher
# or
bun run start
```

Smoke test examples:

```bash
curl -s http://localhost:3002/schedule/
curl -s http://localhost:3002/schedule/2
```

---


## Operational caveats & extensions

| Topic | Recommendation |
|-------|----------------|
| Depot ID volatility | Cached external dataset may rotate IDs between calls → handle `404 availableDepots` UX |
| Duplicate cross-depot realism | Present code applies **same universal task multiset** budgeted per depot (spec simplification — extend with assignment constraints if modelling exclusivity ) |
| Performance guard | For explosive `W`, consider greedy pre-filter bounded knapsack or column generation — only if profiler demands |

---


## References in repository

| File | Role |
|------|------|
| `src/utils/knapsack.ts` | DP + traceback |
| `src/api/client.ts` | External API integration + retries |
| `src/services/scheduler.service.ts` | Aggregation per depot logic |
| `src/routes/schedule.route.ts` | HTTP boundary |
