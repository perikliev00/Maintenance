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
| Mark dirty | ✅ | Rooms / API |
| Създаване на cleaning task + assign HK | ✅ | Rooms, Control |
| Start / Complete cleaning session | ✅ | Rooms |
| Inspect approve / reject (+ findings) | ✅ | Rooms |
| Reassign task | ✅ | Rooms / API |
| Overdue sessions (> 4h running) | ✅ | Rooms (supervisor+), API |
| Report maintenance issue (blocking / non-blocking) | ✅ | Rooms |
| Resolve issue | ✅ | Home, Rooms |
| Home feed — отворени проблеми | ✅ | Home |
| Team — списък хора / филтри | ✅ | Team |
| Control — смяна на роли | ✅ | Control |
| Owner = суперпотребител (всички панели + actions) | ✅ | permissions |
| Dark / light тема | ✅ | цялото UI |
| My Work / персонална опашка | ❌ | roadmap |
| Отделен Repairs панел | ❌ | roadmap |
| Сектори / зони / смени | ❌ | roadmap |
| Присъствие (attendance) | ❌ | roadmap |
| Analytics / карти / badge-и | ❌ | roadmap |
| Одит лог | ❌ | roadmap |
| DB-driven permissions | ❌ | roadmap |

---

## Стек и стартиране

| Част | Технология |
|---|---|
| `api/` | Node.js, Express, TypeScript, Prisma, JWT, Zod, bcrypt |
| `web/` | Vite, React, TypeScript |
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

---

## Домейн модел

### Йерархия на локации

```
Property (Meridian Resort)
  └── Building (MAIN | ANNEX | ROYAL)
        └── Floor
              └── Location (стая / помещения)
```

**Location** е оперативната единица. Върху нея висят cleaning tasks и maintenance tickets.

### Измерения на Location (независими)

| Поле | Enum / смисъл |
|---|---|
| `catalogStatus` | `active` \| `archived` — дали стаята изобщо е в каталога |
| `occupancy` | `vacant` \| `occupied` \| `unknown` — заетост |
| `cleaningStatus` | `dirty` → `in_progress` → `pending_inspection` → `verified_clean` |
| `serviceStatus` | `in_service` \| `out_of_service` \| `unknown` — технически в експлоатация |

Тези полета **не се сриват** в един „статус на стаята“. UI и readiness ги показват отделно.

### Хора

| Entity | Роля |
|---|---|
| `Employee` | Човек в хотела (номер, име, отдел) — изпълнява задачи, инспекции, репорти |
| `User` | Login акаунт, вързан 1:1 към Employee; носи `role` и `isActive` |

### Cleaning агрегати

| Entity | Смисъл |
|---|---|
| `CleaningTask` | Задача за почистване за `hotelDate`, приоритет, assignee, `status`, `version` |
| `CleaningSession` | Конкретна работна сесия (start→complete), idempotency ключове; optional `notes` при complete |
| `Inspection` | Approve/reject от инспектор + `findings` (задължителни при reject) |

**TaskStatus:** `assigned` → `in_progress` → `awaiting_inspection` → `completed` (или `cancelled`).

**SessionStatus:** `running` \| `completed` \| `cancelled`.

### Maintenance

| Entity | Смисъл |
|---|---|
| `MaintenanceTicket` | Ремонтен проблем по location; `blocksRoom` влияе на readiness; при resolve: `resolvedBy`, `resolvedAt`, `resolutionNotes` |

**TicketStatus:** `new` \| `in_progress` \| `resolved` \| `closed`.  
**Category:** climate, electrical, furniture, plumbing, other.  
**Priority:** low, normal, high, urgent.

---

## Readiness (готовност на стая)

Изчисление: `api/src/services/readiness.ts` → `computeReadiness`.

Резултат: `ready` | `not_ready` | `needs_check` + списък `reasons`.

### Правила (по ред)

1. `catalogStatus !== active` → **not_ready** (`archived`)
2. `occupancy` или `serviceStatus` = `unknown` → **needs_check**
3. Иначе събира reasons:
   - `blocking_issue` — има отворен ticket с `blocksRoom`
   - `not_vacant` — occupancy ≠ vacant
   - `cleaning_*` — cleaningStatus ≠ verified_clean
   - `out_of_service` — serviceStatus ≠ in_service
4. Ако няма reasons → **ready**, иначе **not_ready**

**Важно:** complete на почистване **не** прави стаята ready. Само **approved inspection** → `verified_clean`.

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
 verified   rework / findings
 clean      (стаята НЕ е verified_clean)
```

### Кой какво прави (API actions)

| Стъпка | Action | Типични роли (+ owner винаги) |
|---|---|---|
| Mark dirty | `rooms.mark_dirty` | reception, supervisor, manager |
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

От Rooms UI / `POST /maintenance/tickets`:

- `title`, `category`, `priority`, `blocksRoom`
- `reportedBy` = текущият employee
- опционален `commandId` за идемпотентност

Всеки логнат потребител може да репортва (authenticated).

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

Централен регистър: **`api/src/permissions.ts`**.

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

### Панели

| Panel | Роли |
|---|---|
| `home` | всички |
| `rooms` | всички |
| `team` | supervisor, manager, admin, owner |
| `control` | manager, owner |

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
```

Login и `GET /auth/me` връщат `panels[]`, `actions[]`, `landing`.  
Middleware: `requireAction(action)` ползва `canPerform` (owner → allow).  
`requireRoles(...)` също пропуска owner винаги.

### Матрица панел × роля

| | HK | Tech | Reception | Supervisor | Manager | Admin | Owner |
|---|---|---|---|---|---|---|---|
| Home | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Rooms | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Team | | | | ✓ | ✓ | ✓ | ✓ |
| Control | | | | | ✓ | | ✓ |

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
Auth header: `Authorization: Bearer <token>`

### Auth

| Method | Path | Body / бележки |
|---|---|---|
| POST | `/auth/login` | `{ email, password }` → `{ token, user }` с capabilities |
| GET | `/auth/me` | текущ user + `panels`, `actions`, `landing` |

### Rooms

| Method | Path | Право |
|---|---|---|
| GET | `/rooms` | auth |
| GET | `/rooms/:id` | auth |
| POST | `/rooms/:id/mark-dirty` | `rooms.mark_dirty` |

### Cleaning

| Method | Path | Право |
|---|---|---|
| GET | `/cleaning/tasks?hotelDate=` | auth |
| POST | `/cleaning/tasks` | `cleaning.create` |
| POST | `/cleaning/tasks/:id/start` | `cleaning.start` + `{ commandId, expectedVersion? }` |
| POST | `/cleaning/tasks/:id/inspect` | `cleaning.inspect` + `{ commandId, result, findings? }` (findings задължителни при reject) |
| POST | `/cleaning/tasks/:id/reassign` | `cleaning.reassign` |
| POST | `/cleaning/sessions/:id/complete` | `cleaning.complete` + `{ commandId, notes? }` |
| GET | `/cleaning/sessions/review` | `cleaning.review_overdue` |
| GET | `/cleaning/employees/housekeepers` | auth |

### Maintenance

| Method | Path | Право |
|---|---|---|
| GET | `/maintenance/tickets` | auth (`status=open\|all\|resolved`, `locationId`, `limit`) |
| POST | `/maintenance/tickets` | auth (report) |
| POST | `/maintenance/tickets/:id/resolve` | `tickets.resolve` + `{ resolutionNotes? }` |

### People

| Method | Path | Право |
|---|---|---|
| GET | `/people` | `people.view` (`q`, `role`, `includeInactive`) |
| PATCH | `/people/:id/role` | `people.change_role` + `{ role }` |

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
5. JWT ~12h; без token → 401.
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
│       ├── routes/ (auth, rooms, cleaning, maintenance, people)
│       └── services/ (cleaning, readiness, maintenance)
└── web/src/
    ├── App.tsx            # nav + landing от capabilities
    ├── api/client.ts
    ├── theme.ts
    └── pages/ (Login, Home, Rooms, Team, Control)
```

---

## Roadmap

След текущия P0 foundation (още не имплементирано):

- **My Work** — персонални опашки за HK / technician
- **Repairs** като отделен панел
- **Sectors / zones / shifts**
- **Attendance**
- **Cards / badges**, **Analytics**
- Нови роли (напр. `hk_lead`)
- Permission tables в DB + одит лог
- UI бутони изцяло от `actions[]` (без ad-hoc role if-ове)

---

## Git

Remote (ако е конфигуриран): `git@github.com:perikliev00/Maintenance.git`
