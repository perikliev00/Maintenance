# Meridian Maintenance

> English version: [README.en.md](./README.en.md)

Хотелска операционна система за **housekeeping** и **maintenance**: готовност на стаите, задачи за почистване с инспекция, ремонтни тикети, екип и контрол на роли.

Това е жив домейн модел + работещо демо (API + web), изградено инкрементално. По-долу е описан **целият домейн и всичко, което може да се прави днес**.

---

## Съдържание

1. [Цел на продукта](#цел-на-продукта)
2. [Какво може днес (capability matrix)](#какво-може-днес-capability-matrix)
3. [Стек и стартиране](#стек-и-стартиране)
4. [Домейн модел](#домейн-модел)
5. [Readiness (готовност на стая)](#readiness-готовност-на-стая)
6. [Cleaning (почистване)](#cleaning-почистване)
7. [Maintenance (ремонти)](#maintenance-ремонти)
8. [Хора, роли и права](#хора-роли-и-права)
9. [UI панели и действия](#ui-панели-и-действия)
10. [API](#api)
11. [Seed / демо данни](#seed--демо-данни)
12. [Технически правила](#технически-правила)
13. [Структура на кода](#структура-на-кода)
14. [Roadmap](#roadmap)

---

## Цел на продукта

Системата отговаря на въпроса: **„Може ли тази стая да се даде на гост?“** и свързаните оперативни въпроси:

- Кой чисти стаята и на какъв етап е почистването?
- Минала ли е инспекция?
- Има ли блокиращ ремонт?
- Кой от екипа какво вижда и какво може да прави?

Readiness **не е един статус**, а композиция от няколко независими измерения + блокиращи тикети.

---

## Какво може днес (capability matrix)

| Възможност | Статус | Къде |
|---|---|---|
| Login / logout (JWT) | ✅ | Login |
| Capabilities (`panels`, `actions`, `landing`) | ✅ | `/auth/me`, login |
| Списък стаи + readiness reasons | ✅ | Rooms |
| Общи части (каталог + cleaning/tickets) | ✅ | Общи части / `/common-areas` |
| Каталог помещения (CRUD + архив) | ✅ | Почистване → Каталог / `/locations` |
| Occupancy / service status | ✅ | Rooms detail / `/locations/:id/occupancy`, `…/service-status` |
| Mark dirty | ✅ | Rooms, Общи части / API |
| Създаване на cleaning task + assign HK | ✅ | Rooms, Control |
| Start / Complete cleaning session | ✅ | Rooms |
| Inspect approve / reject (+ findings) | ✅ | Rooms |
| Reassign task | ✅ | Rooms / API |
| Overdue sessions (> 4h running) | ✅ | Rooms (supervisor+), API |
| Live табло (S09) | ✅ | Табло / `/operations/live` |
| Report maintenance issue (blocking / non-blocking) | ✅ | Rooms, Home |
| Каталог повреди — категории + опции (S10) | ✅ | Настройки → „Опции за проблеми“ |
| Resolve issue | ✅ | Home, Rooms |
| Home feed — отворени проблеми | ✅ | Home |
| Team — списък хора / филтри | ✅ | Team |
| Control — смяна на роли | ✅ | Control |
| Настройки (модули, флагове, операции, хронология) | ✅ | Настройки / `/settings` |
| Права — DB-driven матрица роли × панели/actions | ✅ | Права / `/permissions` |
| Owner = суперпотребител (всички панели + actions) | ✅ | permissions |
| Dark / light тема | ✅ | цялото UI |
| Live updates (SSE) | ✅ | `/events/stream` |
| Дневен план Clock (S12) | ✅ | План / `/daily-plan` (+ JSON импорт; без реален PMS) |
| My Work / персонална опашка | ✅ | Моите задачи / `/my-work` + PWA |
| Отделен Repairs панел | ✅ | Повреди / `/maintenance` lifecycle UI |
| Сектори / смени (панел Почистване) | ✅ | Почистване / `/sectors`, `/shifts`; ростер `GET/PUT /shifts/roster`; `CleaningTask.shiftId` |
| Snapshot сектор + отговорник на задача | ✅ | `CleaningTask.sectorId` / `sectorSupervisorEmployeeId` |
| Data scope „мои сектори“ (супервайзър) | ✅ | `dataScope` + Live/Plan/Rooms/Results/Analytics + ticket create, sync push, sectors (own), live audit/SSE |
| QR за помещения | ✅ | таб QR + `#/room-qr/:token` (само identify) |
| Присъствие (attendance) | ✅ | Присъствие / `/attendance` |
| Analytics — резултати по камериер | ✅ | Резултати / `/cleaning/results` |
| Умна аналитика (S14, §9) | ✅ | Аналитика / `/analytics/summary` |
| Карти (S11) — UI + БД, без хардуер | ✅ | Карти / `/cards` |
| Одит лог | ✅ | Одит / `/audit` (+ JobRun в панела) |
| Offline sync | ✅ | IndexedDB outbox + My Work cache (per `userId`; purge/lock on account switch); `/sync/push` + `/sync/pull`; SW precache only (no authenticated `/api` GET cache) |
| Фонови jobs | ✅ | in-process scheduler (lock / overdue / SLA) |

---

## Стек и стартиране

| Част | Технология |
|---|---|
| `api/` | Node.js, Express, TypeScript, Prisma, JWT, Zod, bcrypt |
| `web/` | Vite, React, TypeScript, PWA (vite-plugin-pwa) |
| `e2e/` | Playwright (browser smoke / UI flows) |
| DB | PostgreSQL 16 (Docker), хост порт **5433** |

```bash
docker compose up -d

cd api
npm install
npx prisma migrate dev
npm run db:seed
npm run dev

cd web
npm install
npm run dev
```

- API: http://localhost:4000 (`/health`)
- Web: http://localhost:5173
- `DATABASE_URL=postgresql://maintenance:maintenance@localhost:5433/maintenance`
- Парола за демо потребители: **`demo1234`**

### E2E (Playwright)

Изисква seed-ната DB (и при нужда вече пуснати API/web — иначе Playwright ги стартира сам).

```bash
cd e2e
npm install
npm run install:browsers
npm test
```

- `E2E_START_SERVERS=0` — не стартирай API/web (ползвай вече работещи инстанции)
- CI job: `E2E` в `.github/workflows/ci.yml`

---

## Домейн модел

### Йерархия на локации

```
Property (Meridian Resort)
  └── Building (MAIN | ANNEX | ROYAL)
        └── Floor
              └── Location (kind: room | common_area)
```

**Location** е оперативната единица. Върху нея висят cleaning tasks и maintenance tickets.  
`kind` разделя стаи и общи части; Rooms UI / `/rooms` показва само `room`, панел „Общи части“ / `/common-areas` — само `common_area`.

### Измерения на Location (независими)

| Поле | Enum / смисъл |
|---|---|
| `kind` | `room` \| `common_area` |
| `catalogStatus` | `active` \| `archived` — дали локацията е в каталога |
| `occupancy` | `vacant` \| `occupied` \| `unknown` — заетост (**само за стаи** в readiness) |
| `cleaningStatus` | `dirty` → `in_progress` → `pending_inspection` → `verified_clean` |
| `cleaningCycle` | Монотонен generation; само текущият cycle може да пише `cleaningStatus` |
| `serviceStatus` | `in_service` \| `out_of_service` \| `unknown` — технически в експлоатация |

Тези полета **не се сриват** в един „статус“. UI и readiness ги показват отделно.

### Хора

| Entity | Роля |
|---|---|
| `Employee` | Човек в хотела (номер, име, отдел) — изпълнява задачи, инспекции, репорти |
| `User` | Login акаунт, вързан 1:1 към Employee; носи `role` и `isActive` |

### Cleaning агрегати

| Entity | Смисъл |
|---|---|
| `CleaningTask` | Задача за почистване за `hotelDate`, `serviceType` (`stayover` \| `departure` \| `arrival` \| `common_area`), приоритет, assignee, `status`, `completedAt` (при completed), `version` |
| `CleaningSession` | Конкретна работна сесия (start→complete|cancel), idempotency ключове; optional `notes`; `anomalyFlags`; няма pause / adjustment |
| `Inspection` | Approve/reject от инспектор + `findings` (задължителни при reject) |

**TaskStatus:** `assigned` → `in_progress` → `awaiting_inspection` → `completed` (или `cancelled`). При reject → `rework` (същата задача; нова сесия при следващ Start). `completedAt` се записва при approve или при auto-complete (когато `require_inspection=false`).

**SessionStatus:** `running` \| `completed` \| `cancelled`.

**Аналитични броячи (§9):** сесии ≠ задачи ≠ различни стаи. `rework` е брояч на rejected инспекции (не `serviceType`). Аномална сесия: непразни `anomalyFlags` или продължителност ≥ `2 × overdueSessionMinutes` — минутите отиват в `totalExcludedSessionMinutes` и не влизат във валидно време / P50 / P90 / производителност. При complete на сесия, ако продължителността ≥ `overdueSessionMinutes`, се записва флаг `overdue` (същата семантика като overdue job-а), за да не зависят метриките от това дали job-ът е минал докато сесията е била running.

### Maintenance

| Entity | Смисъл |
|---|---|
| `MaintenanceCategory` | Конфигурируеми категории (key, BG/EN име, подредба, active/archived) |
| `IssueOption` | Предварително зададени опции за сигнал (вид, категория, defaults) |
| `MaintenanceTicket` | Ремонтен проблем по location; snapshot на категорията (`categoryKey`, labels); optional `issueOptionId`; `blocksRoom` влияе на readiness |

**TicketStatus:** `new` \| `in_progress` \| `resolved` \| `closed`.  
**Категория на тикет:** snapshot при създаване (промяна в каталога не променя историята).  
**Priority:** low, normal, high, urgent.

---

## Readiness (готовност на стая)

Изчисление: `api/src/services/readiness.ts` → `computeReadiness`.

Резултат: `ready` | `not_ready` | `needs_check` + списък `reasons`.

### Правила (по ред)

1. `catalogStatus !== active` → **not_ready** (`archived`)
2. За **стаи**: `occupancy` или `serviceStatus` = `unknown` → **needs_check**  
   За **общи части**: само `serviceStatus` = `unknown` → **needs_check** (occupancy се игнорира)
3. Иначе събира reasons:
   - `blocking_issue` — има отворен ticket с `blocksRoom`
   - `not_vacant` — occupancy ≠ vacant (**само стаи**)
   - `cleaning_*` — cleaningStatus ≠ verified_clean
   - `out_of_service` — serviceStatus ≠ in_service
4. Ако няма reasons → **ready**, иначе **not_ready**

**Важно:** complete на почистване **не** прави локацията ready. Само **approved inspection** → `verified_clean`.

---

## Cleaning (почистване)

### Жизнен цикъл

```
[Create task]
   status=assigned, cleaningStatus остава dirty (или както е)
        │
        ▼
[Start]  → session running
   task=in_progress, cleaningStatus=in_progress
        │
        ▼
[Complete session]
   task=awaiting_inspection, cleaningStatus=pending_inspection
        │
   ┌────┴────┐
   ▼         ▼
[Approve]  [Reject]
 verified   task → rework + findings
 clean      (стаята → dirty; предишните сесии се пазят;
             нова сесия при следващ Start)
```

### Cleaning cycle (generation)

`Location.cleaningCycle` е монотонен брояч. Всяка нова cleaning task получава текущия cycle при create (`CleaningTask.cleaningCycle`). Само задачата с **текущия** cycle може да променя `cleaningStatus` (и оттам readiness).

- Нова задача / mark dirty / departure dirty → bump на cycle
- Stale approve (напр. вчерашна inspection докато днес вече се чисти) → task става `completed`, но location **не** става `verified_clean`
- Start/complete/cancel върху superseded cycle → `409 stale_cleaning_cycle`

### Кой какво прави (API actions)

| Стъпка | Action | Типични роли (+ owner винаги) |
|---|---|---|
| Mark dirty | `rooms.mark_dirty` | reception, supervisor, manager |
| Catalog CRUD / archive | `rooms.manage` | supervisor, manager, admin |
| Set occupancy | `rooms.set_occupancy` | reception, supervisor, manager |
| Set service status | `rooms.set_service_status` | supervisor, manager, admin |
| Create task | `cleaning.create` | reception, supervisor, manager |
| Start | `cleaning.start` | housekeeper, supervisor |
| Complete | `cleaning.complete` | housekeeper, supervisor |
| Inspect | `cleaning.inspect` | supervisor, manager |
| Reassign | `cleaning.reassign` | reception, supervisor, manager |
| Overdue review | `cleaning.review_overdue` | supervisor, manager |

### Оперативни инварианти

- Една **running** session на задача.
- Една **running** session на housekeeper едновременно.
- Start / complete / inspect са **идемпотентни** чрез клиентски `commandId` (UUID).
- `version` на task за optimistic concurrency при start/reassign (`expectedVersion`).
- Overdue = running session по-дълга от **4 часа**.

### Reassign

Сменя `assignedEmployeeId`, записва `reassignReason`, увеличава `version`. Не рестартира автоматично сесията произволно — ползва се когато задачата трябва да мине при друг HK.

---

## Maintenance (ремонти)

### Създаване (Report issue)

От Rooms / Home UI или `POST /maintenance/tickets` (action `tickets.report`):

- **От опция:** `issueOptionId`, optional `title` override, `priority`, `blocksRoom`
- **Свободен текст:** `title` + `categoryId` (активна категория), `priority`, `blocksRoom`
- `reportedBy` = текущият employee
- опционален `commandId` за идемпотентност

Каталог: `GET /maintenance/categories`, `GET /maintenance/issue-options` (report). Управление: action `issue_options.manage` (manager/admin) в Настройки.

### Блокиране на стая

Ако `blocksRoom: true` и ticket-ът е отворен → readiness reason `blocking_issue` → стаята **не е ready**, дори да е verified_clean и vacant.

### Resolve

`POST /maintenance/tickets/:id/resolve` — action `tickets.resolve`.  
Body (опционално): `{ resolutionNotes?: string }`.  
Записва `resolvedBy` (текущият employee), `resolvedAt` и `resolutionNotes`.  
Роли: supervisor, manager, technician, admin, **owner**.

Показва се в **Home** (feed) и в Rooms при blocking issues.  
В **Control** има секция „Наскоро резолвнати“ с кой / кога / описание.

---

## Хора, роли и права

Централен каталог + defaults: **`api/src/permissions.ts`**.  
Runtime grants: таблица **`RoleGrant`** (редакция през панел Права).

### Роли

| Role | BG етикет | Смисъл |
|---|---|---|
| `owner` | собственик | Суперпотребител — **всички** панели и actions |
| `manager` | управител | Control + операции; **не** пипа owner/admin роли |
| `admin` | администратор | Team + resolve; без Control по подразбиране |
| `supervisor` | супервайзър | HK лидер: create/inspect/reassign/team |
| `reception` | рецепция | Mark dirty, create/reassign tasks, report |
| `housekeeper` | камериер | Start/complete на своите задачи, report |
| `technician` | техник | Report + resolve issues |

### Твърди правила

1. **`owner` (собственик) е специална супер-роля** — вижда всички панели, може всички actions в API и UI (вкл. start/complete чужди задачи, inspect, смяна на всяка роля). В UI има златен badge и банер „пълен достъп“.
2. **`manager`** може Control и `people.change_role`, но **403** при опит да зададе/промени `owner` или `admin`.
3. Не може да се demote **последният активен owner**.
4. Auth винаги е задължителен; owner ≠ anonymous.
5. **Capability ≠ data scope.** `RoleGrant` (панел/action) решава *дали* можеш действието. Отделен слой **`dataScope`** (§5) ограничава *кои* редове виждаш/променяш:
   - `owner` / `manager` / `admin` / `reception` → целия обект
   - `supervisor` → сектори с `primarySupervisorEmployeeId = me`
   - `housekeeper` → задачи с `assignedEmployeeId = me` (+ стаи/тикети свързани с тях)
   - `technician` → тикети с `assigneeId = me` (+ техните помещения)
   - List API филтрира; директен достъп извън обхвата → **403** (не 404 / „няма данни“)
   - Покрити пътища: rooms/tasks/tickets (вкл. create), sync push, sectors CRUD (само свои), live audit + SSE
   - **Sector location set** (`PUT /sectors/:id/locations`): source + destination се валидират **вътре в транзакцията**. Supervisor може само да пребалансира стаи вече в своите сектори. Чужди/неприсвоени стаи изискват `sectors.transfer_cross` (default: manager/admin).
   - **Audit list** винаги минава през data scope: sector-scoped актьори не виждат чужди `locationId` / чужди `entityType=sector` редове.
6. **Исторически назначения** пазят `CleaningTask.sectorId` и `sectorSupervisorEmployeeId` към момента на създаване (не се презаписват при местене на стая в друг сектор).

### Панели

| Panel | Роли |
|---|---|
| `home` | всички |
| `rooms` | всички |
| `common` | всички (същите като `rooms`) |
| `team` | supervisor, manager, admin, owner |
| `control` | manager, owner |
| `settings` | manager, admin, owner |
| `permissions` | manager, admin, owner |

### Landing след login

| Role | Landing |
|---|---|
| housekeeper, technician | `home` |
| reception, supervisor | `rooms` |
| manager, owner | `control` |
| admin | `team` |

### Actions (пълен списък)

```
rooms.view
rooms.mark_dirty
rooms.manage
rooms.set_occupancy
rooms.set_service_status
cleaning.create
cleaning.start
cleaning.complete
cleaning.inspect
cleaning.reassign
cleaning.review_overdue
tickets.report
tickets.resolve
people.view
people.change_role
control.access
settings.manage
permissions.manage
sectors.manage
sectors.transfer_cross
```

Login и `GET /auth/me` връщат `panels[]`, `actions[]`, `landing`.  
Middleware: `requireAction(action)` ползва `canPerform` (owner → allow).

### Матрица панел × роля

| | HK | Tech | Reception | Supervisor | Manager | Admin | Owner |
|---|---|---|---|---|---|---|---|
| Home | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Rooms | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Общи части | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Team | | | | ✓ | ✓ | ✓ | ✓ |
| Control | | | | | ✓ | | ✓ |
| Настройки | | | | | ✓ | ✓ | ✓ |
| Права | | | | | ✓ | ✓ | ✓ |

### Матрица ключови actions × роля

| Action | HK | Tech | Rec | Sup | Mgr | Adm | Owner |
|---|---|---|---|---|---|---|---|
| mark_dirty | | | ✓ | ✓ | ✓ | | ✓ |
| cleaning.create | | | ✓ | ✓ | ✓ | | ✓ |
| cleaning.start/complete | ✓ | | | ✓ | | | ✓ |
| cleaning.inspect | | | | ✓ | ✓ | | ✓ |
| cleaning.reassign | | | ✓ | ✓ | ✓ | | ✓ |
| tickets.resolve | | ✓ | | ✓ | ✓ | ✓ | ✓ |
| people.view | | | | ✓ | ✓ | ✓ | ✓ |
| people.change_role | | | | | ✓ | | ✓ |
| control.access | | | | | ✓ | | ✓ |
| settings.manage | | | | | ✓ | ✓ | ✓ |
| permissions.manage | | | | | ✓ | ✓ | ✓ |

*(Owner колоната е винаги ✓ за всички известни actions.)*

---

## UI панели и действия

### Login

- Email + парола
- Тема dark/light (localStorage)
- След успех → `landing` панел

### Home

- Списък отворени maintenance tickets
- Resolve бутон за роли с `tickets.resolve`

### Rooms

- Таблица стаи: сграда, етаж, номер, измерения, readiness, reasons, active task
- Actions според роля (UI все още ползва частично role checks; API е source of truth чрез actions)
- Overdue секция за supervisor (API допуска и manager/owner)
- Report issue форма (title, category, blocks room)
- Resolve на blocking issues

### Team

- Списък хора: име, номер, email, роля, отдел
- Достъп: `people.view`

### Control

- Смяна на роли (`assignableRolesFor`)
  - owner → всички роли
  - manager → без owner/admin
- Бързи операции: create task, resolve issues
- Достъп: `control.access` / `people.change_role`

### Тема

`data-theme` + CSS variables — dark / light.

---

## API

Base: `http://localhost:4000`  
Auth: httpOnly cookies (`session` access JWT ~15m, `refresh` ~14d) + CSRF double-submit (`csrf` cookie + `X-CSRF-Token`). Scripts may use `Authorization: Bearer <access>`. Browser default API base: `/api` (Vite proxy → API).

### Auth

| Method | Path | Body / бележки |
|---|---|---|
| POST | `/auth/login` | `{ email, password }` → `{ user, expiresIn }` + Set-Cookie (session/refresh/csrf) |
| POST | `/auth/refresh` | refresh cookie → нови cookies + `{ ok, expiresIn }` |
| POST | `/auth/logout` | revoke текуща сесия + clear cookies |
| POST | `/auth/logout-all` | auth — revoke всички сесии на user + clear cookies |
| GET | `/auth/me` | auth → user + capabilities |

### Rooms

| Method | Path | Право |
|---|---|---|
| GET | `/rooms` | auth (`kind=room`) |
| GET | `/rooms/:id` | auth |
| POST | `/rooms/:id/mark-dirty` | `rooms.mark_dirty` |

### Common areas

| Method | Path | Право |
|---|---|---|
| GET | `/common-areas` | auth (`kind=common_area`) |
| GET | `/common-areas/:id` | auth |
| POST | `/common-areas/:id/mark-dirty` | `rooms.mark_dirty` |

### Locations (каталог + оперативни състояния)

| Method | Path | Право |
|---|---|---|
| GET | `/locations/hierarchy` | `rooms.manage` — buildings → floors за create/edit |
| GET | `/locations?kind=&includeArchived=` | `rooms.manage` — каталожен списък |
| POST | `/locations` | `rooms.manage` — `{ floorId, number, kind? }` |
| PATCH | `/locations/:id` | `rooms.manage` — каталожни полета |
| POST | `/locations/:id/archive` | `rooms.manage` |
| POST | `/locations/:id/restore` | `rooms.manage` |
| PATCH | `/locations/:id/occupancy` | `rooms.set_occupancy` — само стаи |
| PATCH | `/locations/:id/service-status` | `rooms.set_service_status` |
| GET | `/locations/:id/qr` | `sectors.manage` — payload + scan URL |
| GET | `/locations/by-qr/:token` | auth — идентифицира помещение (без auto start/complete) |

UI: каталог в Почистване → Каталог; occupancy/service в detail drawer на Стаи / Общи части.

### Settings

| Method | Path | Право |
|---|---|---|
| GET | `/settings/public` | auth (modules, interface, operations subset, flags subset) |
| GET | `/settings` | `settings.manage` |
| GET | `/settings/system` | `settings.manage` |
| GET | `/settings/history` | `settings.manage` |
| PATCH | `/settings/:key` | `settings.manage` |

### Live events (SSE)

| Method | Path | Право |
|---|---|---|
| POST | `/events/ticket` | auth (Bearer) — краткоживущ ticket (~5 мин, `purpose=sse`) за EventSource |
| GET | `/events/stream` | auth: cookie session, Bearer access JWT, или `?ticket=` (краткоживущ SSE ticket). |

Stream tickets и отворени SSE връзки са вързани към активна `AuthSession` (роля от DB, не от JWT); при смяна на роля сесиите се revoke-ват и elevated SSE спира най-късно в рамките на един heartbeat (~25s).

Събития: `connected`, `location.changed`, `cleaning.changed`, `ticket.changed`, `settings.changed`, `people.changed`, `revoked`. Клиентите ги ползват като invalidate и презареждат.

Доставка: `settings.changed` / `people.changed` — към всеки логнат; `location` / `cleaning` / `ticket` — само ако ID-тата са в `resolveDataScope` на абоната (без over-sharing между сектори/назначения).

### Permissions (role matrix)

| Method | Path | Право |
|---|---|---|
| GET | `/permissions/matrix` | `permissions.manage` |
| PUT | `/permissions/roles/:role` | `permissions.manage` |
| GET | `/permissions/history` | `permissions.manage` |

### Cleaning

| Method | Path | Право |
|---|---|---|
| GET | `/cleaning/tasks?hotelDate=` | auth |
| POST | `/cleaning/tasks` | `cleaning.create` |
| POST | `/cleaning/tasks/:id/start` | `cleaning.start` + `{ commandId, expectedVersion? }` |
| POST | `/cleaning/tasks/:id/inspect` | `cleaning.inspect` + `{ commandId, result, findings? }` (findings задължителни при reject) |
| POST | `/cleaning/tasks/:id/reassign` | `cleaning.reassign` |
| POST | `/cleaning/sessions/:id/complete` | `cleaning.complete` + `{ commandId, notes? }` |
| POST | `/cleaning/sessions/:id/cancel` | `cleaning.review_overdue` + `{ commandId, notes? }` (running → cancelled; без adjustment) |
| GET | `/cleaning/sessions/review` | `cleaning.review_overdue` |
| GET | `/cleaning/employees/housekeepers` | auth |
| GET | `/cleaning/results?from=&to=&page=&pageSize=&serviceType=` | `cleaning.results_view` (scoped); `serviceType` = comma list |

Резултати по камериер (S07–S08, §9): отделни броячи — `completedSessions`, `completedTasks` (по `completedAt`), `acceptedTasks` (approved или auto-complete), `reworkEvents` (rejected), `anomalousSessions`, `distinctRooms`, `totalValidSessionMinutes`, `totalExcludedSessionMinutes`. Навреме % = `completedAt ≤ dueAt` за completed задачи със срок. Производителност = completed tasks / валидни сесийни часове (аномалните са изключени). Графика: сесии по час. Филтър `serviceType` за съпоставими единици. „Брой камериери“ = служители с ≥1 completed session в периода. При create/reassign задачата записва `sectorId` + `sectorSupervisorEmployeeId` snapshot; `serviceType` се извежда от вид помещение / дневен план (или се подава изрично).

Housekeeping analytics (`GET /analytics/summary?domain=housekeeping`): същите дефиниции върху `completedAt`; плюс `distinctRooms` и валидни/изключени минути; breakdown `byServiceType` + `byPriority`; P50/P90 върху валидни сесии.

### Сектори / смени / QR

| Method | Path | Право |
|---|---|---|
| GET | `/sectors` | `sectors.manage` |
| GET | `/sectors/mine` | auth — активни сектори с primary supervisor = текущия служител |
| GET/POST/PATCH | `/sectors`, `…/:id` | `sectors.manage` (supervisor не може `POST` — не разширява scope) |
| PUT | `/sectors/:id/locations` | `sectors.manage` + in-TX source/destination scope; чужди/unassigned → `sectors.transfer_cross` |
| GET/POST/PATCH | `/shifts`, `…/:id` | `shifts.manage` (GET активни: също `plan.manage` / cleaning create|reassign) |
| GET/PUT | `/shifts/roster?hotelDate=` | `shifts.manage` — дневен ростер employee↔shift |

`CleaningTask.shiftId` — планирана смяна при create/reassign/дневен план. `EmployeeShiftRoster` — кой е на коя смяна за хотелска дата (капацитет). My Work филтрира по ростер смяна (задачи без смяна остават видими).

Scan UI: `#/room-qr/:token`. Печат: таб QR в Почистване. Каталог/QR endpoints: виж **Locations** по-горе.

### Operations (Live board S09)

| Method | Path | Право |
|---|---|---|
| GET | `/operations/live` | `operations.view_live` |

Агрегат за супервайзър/мениджър: активни сесии (elapsed, overdue, anomaly = 2× overdue праг), току-що завършени (60 мин), needs attention (инспекция / past due / blocking tickets), одит feed (инспекции + completes, 24ч). Клиентът ползва polling ~15s и stale/offline индикатор.

### Daily plan (S12 / Clock)

| Method | Path | Право |
|---|---|---|
| GET | `/daily-plan?hotelDate=` | `plan.view` |
| POST | `/daily-plan` | `plan.manage` — ръчен запис |
| POST | `/daily-plan/import` | `plan.manage` — договорен JSON (не жив PMS) |
| DELETE | `/daily-plan/:id` | `plan.manage` |

Импортът резолва стаи по `buildingCode` + `roomNumber`, пише `source=import`, пази `DailyPlanImportBatch` и е идемпотентен по `externalId` / съществуващ запис (ръчните не се презаписват). Пример: `api/fixtures/daily-plan-import.example.json`.

### Maintenance

| Method | Path | Право |
|---|---|---|
| GET | `/maintenance/categories` | `tickets.report` (`includeInactive` за admin UI) |
| POST/PATCH | `/maintenance/categories`, `…/:id/archive` | `issue_options.manage` |
| GET | `/maintenance/issue-options` | `tickets.report` |
| POST/PATCH | `/maintenance/issue-options`, `…/reorder`, `…/:id/archive` | `issue_options.manage` |
| GET | `/maintenance/tickets` | auth (`status=open\|all\|resolved`, `locationId`, `limit`) |
| POST | `/maintenance/tickets` | `tickets.report` — `issueOptionId` **или** `categoryId`+`title` |
| POST | `/maintenance/tickets/:id/resolve` | `tickets.resolve` + `{ resolutionNotes? }` |

### People

| Method | Path | Право |
|---|---|---|
| GET | `/people` | `people.view` (`q`, `role`, `includeInactive`) |
| PATCH | `/people/:id/role` | `people.change_role` + `{ role }` |

### Attendance (S13)

| Method | Path | Право |
|---|---|---|
| GET | `/attendance/intervals` | `attendance.view` (`scope=month\|today\|week\|review`, `month`, `department`, `q`, `limit`, `cursor`) — връща `{ intervals, total, nextCursor, limit, maxClockSkewSeconds }` |
| GET | `/attendance/intervals/:id` | `attendance.view` |
| GET | `/attendance/export.csv` | `attendance.view` (същите филтри; batch експорт, таван 50 000 реда → 413; header `X-Attendance-Total`) |
| POST | `/attendance/events` | `attendance.ingest` — симулиран терминал; идемпотентно по `(source, externalEventId)`; при retry преизгражда интервали, ако събитието е записано без интервал (вкл. break events и concurrent `P2002` race) |
| POST | `/attendance/adjustments` | `attendance.request_adjustment` |
| POST | `/attendance/adjustments/:id/review` | `attendance.approve_adjustment` + `{ decision: approved\|rejected }` |

Оригиналните `AttendanceEvent` записи не се мутират при одобрена корекция. Нощна смяна е един интервал; `hotelDate` = дата на началото в `operations.hotelTimezone`. Ingest е транзакционен и преиграва event stream-а за hotel day на служителя, за да се възстанови partial failure при retry; concurrent duplicate create се хваща като `P2002` и минава през същия reconcile път.

### Audit history migration note

`20261002260000_unified_audit_events` копира `PermissionChange` / `SettingChange` в `AuditEvent` и после ги drop-ва. `20261006220000_backfill_legacy_audit_history` е safety net за partial/pre-drop състояния (обикновено no-op).

Ако миграцията вече е била приложена със старата DROP-only версия, Prisma може да докладва checksum mismatch — обновете checksum-а в `_prisma_migrations` за този migration name след умишлената промяна; не редактирайте други приложени миграции. Изтритите редове **не** се връщат от нова миграция: възстановете staging таблици от backup и изпълнете [`api/prisma/scripts/restore_permission_setting_history.sql`](api/prisma/scripts/restore_permission_setting_history.sql). Без backup историята не може да се изобрети.

### Health

`GET /health` → `{ ok: true }`

Грешки: `{ error, message, details? }`.

---

## Seed / демо данни

`cd api && npm run db:seed` — **изтрива и пресъздава** данните.

| Какво | Количество / съдържание |
|---|---|
| Property | Meridian Resort |
| Buildings | MAIN (4×10), ANNEX (2×5), ROYAL (10×30) → **~350 стаи** |
| Users | ~26 акаунта, парола `demo1234` |
| Tickets | ~12 отворени (част блокиращи) |
| Tasks | примерни assigned / awaiting_inspection |

### Основни демо акаунти

| Email | Роля |
|---|---|
| `owner@meridian.local` | owner |
| `manager@meridian.local` | manager |
| `admin@meridian.local` | admin |
| `supervisor@meridian.local` | supervisor |
| `reception@meridian.local` | reception |
| `housekeeper@meridian.local` | housekeeper |
| `technician@meridian.local` | technician |

Има и допълнителни HK / tech / managers в seed.

### Препоръчан demo flow

1. **supervisor** — dirty стая → Create task (assign HK).
2. **housekeeper** — Start → Complete → стаята `pending_inspection`.
3. **supervisor** — Approve (или Reject).
4. Report issue с blocks room → Resolve.
5. **owner** — всички табове; inspect / role change без 403.
6. **manager** — опит за role=`owner` → **403**.

---

## Технически правила

1. Complete ≠ verified clean — само inspection approve.
2. Owner никога не е скрит от панел и не е блокиран на известен action.
3. Manager не управлява owner/admin identities.
4. Idempotency чрез `commandId` на критични команди.
5. Access JWT ~15m в httpOnly cookie (+ refresh ~14d); без валидна сесия → 401.
6. Readiness е derived — не се пази като колона в DB.
7. Postgres на хост **5433**, не 5432.

---

## Структура на кода

```
maintenance/
├── docker-compose.yml
├── README.md              ← този файл (BG)
├── README.en.md           ← English
├── api/
│   ├── prisma/schema.prisma, migrations/, seed.ts
│   └── src/
│       ├── permissions.ts
│       ├── middleware/auth.ts
│       ├── routes/ (auth, rooms, cleaning, maintenance, people, settings, events)
│       ├── events/bus.ts
│       └── services/ (cleaning, readiness, maintenance)
└── web/src/
    ├── App.tsx            # nav + landing от capabilities
    ├── api/client.ts
    ├── hooks/useLiveRefresh.ts
    ├── theme.ts
    ├── offline/           # IndexedDB queue + My Work cache (user-partitioned; cleared on logout/switch)
    ├── pages/ (Login, MyWork, Repairs, Audit, Home, Rooms, Team, Plan, Attendance, Cards, Results, Analytics, Control, Settings, Permissions)
```

---

## Roadmap

След текущия foundation (още не имплементирано):

- Физически encoder адаптер за карти (хардуер)
- Нови роли (напр. `hk_lead`)
- UI бутони изцяло от `actions[]` (без ad-hoc role if-ове)
- QR scan → confirm start/complete (сега само идентификация)
- Реални PMS/Clock импорт адаптери (скелетът `DailyPlanImportBatch` / JobRun е наличен)

---

## Git

Remote (ако е конфигуриран): `git@github.com:perikliev00/Maintenance.git`
