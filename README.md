# Imperial Maintenance — first vertical slice

Working demo of rooms + cleaning start/complete with readiness.

## Stack

- `api/` — Node.js, Express, TypeScript, Prisma, JWT
- `web/` — Vite, React, TypeScript
- PostgreSQL 16 via Docker Compose

## Prerequisites

- Node.js 20+
- Docker Desktop running

## Setup

```bash
# 1. Start database (host port 5433 — avoids local Postgres on 5432)
docker compose up -d

# 2. API
cd api
npm install
npx prisma migrate dev --name init
npm run db:seed
npm run dev

# 3. Web (new terminal)
cd web
npm install
npm run dev
```

Postgres URL (see `api/.env`): `postgresql://maintenance:maintenance@localhost:5433/maintenance`

- API: http://localhost:4000
- Web: http://localhost:5173

## Demo users

Password for all: `demo1234`

| Email | Role |
|---|---|
| reception@imperial.local | reception |
| housekeeper@imperial.local | housekeeper |
| supervisor@imperial.local | supervisor |

## Demo flow

1. Sign in as **supervisor** (or reception).
2. Pick a dirty room (or Mark dirty), choose housekeeper, **Create task**.
3. Sign out, sign in as **housekeeper**.
4. **Start** then **Complete** the task.
5. Room `cleaningStatus` becomes `verified_clean` and readiness recalculates.

## Notes

- Inspection is not implemented yet; complete temporarily sets `verified_clean`.
- Start/complete are idempotent via client `commandId` (UUID).
- One running session per task and per housekeeper.
