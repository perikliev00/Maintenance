/**
 * Destructive demo database seed for local / CI demos.
 *
 * Wipes domain tables (order respects FKs), then rebuilds a full Meridian
 * property with rooms, common areas, roles, cleaning/maintenance samples,
 * sectors, daily plan, attendance, cards, audit, and job/sync demos.
 *
 * Shared password for activated users: `demo1234`.
 * Run via the package seed script after migrations; not for production.
 */
import {
  PrismaClient,
  Role,
  CleaningStatus,
  Occupancy,
  ServiceStatus,
  TicketStatus,
  Priority,
  TaskStatus,
  SessionStatus,
  LocationKind,
  InspectionResult,
} from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { assertDemoSeedAllowed } from "../src/demoSeedGuard";

const prisma = new PrismaClient();

/** Minimal employee + login shape used when creating Employee/User pairs. */
type EmpDef = {
  employeeNumber: string;
  fullName: string;
  department: string;
  email: string;
  role: Role;
};

/** Round-robin picker so status/occupancy demos stay evenly distributed. */
function cycle<T>(arr: T[], i: number): T {
  return arr[i % arr.length];
}

async function main() {
  assertDemoSeedAllowed();
  // Wipe in dependency-safe order. `.catch` tolerates tables missing on older DBs.
  await prisma.inspection.deleteMany();
  await prisma.cleaningSession.deleteMany();
  await prisma.ticketEvent.deleteMany().catch(() => undefined);
  await prisma.ticketReopenEvent.deleteMany().catch(() => undefined);
  await prisma.cleaningTask.deleteMany();
  await prisma.maintenanceTicket.deleteMany();
  await prisma.slaPolicy.deleteMany().catch(() => undefined);
  await prisma.issueOption.deleteMany();
  await prisma.maintenanceCategory.deleteMany();
  await prisma.invitation.deleteMany();
  await prisma.device.deleteMany();
  await prisma.attendanceAdjustment.deleteMany().catch(() => undefined);
  await prisma.attendanceInterval.deleteMany().catch(() => undefined);
  await prisma.attendanceEvent.deleteMany().catch(() => undefined);
  await prisma.dailyPlanEntry.deleteMany().catch(() => undefined);
  await prisma.dailyPlanImportBatch.deleteMany().catch(() => undefined);
  await prisma.accessGrant.deleteMany().catch(() => undefined);
  await prisma.accessCard.deleteMany().catch(() => undefined);
  await prisma.sectorLocation.deleteMany().catch(() => undefined);
  await prisma.sector.deleteMany().catch(() => undefined);
  await prisma.employeeShiftRoster.deleteMany().catch(() => undefined);
  await prisma.shift.deleteMany().catch(() => undefined);
  await prisma.auditEvent.deleteMany().catch(() => undefined);
  await prisma.jobRun.deleteMany().catch(() => undefined);
  await prisma.syncRun.deleteMany().catch(() => undefined);
  await prisma.appSetting.deleteMany();
  await prisma.roleGrant.deleteMany();
  await prisma.notificationDelivery.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.user.deleteMany();
  await prisma.employee.deleteMany();
  await prisma.location.deleteMany();
  await prisma.floor.deleteMany();
  await prisma.building.deleteMany();
  await prisma.property.deleteMany();

  // --- Property topology: MAIN + ANNEX (+ ROYAL later for volume) ---
  const property = await prisma.property.create({
    data: { name: "Meridian Resort" },
  });

  const mainBuilding = await prisma.building.create({
    data: {
      propertyId: property.id,
      name: "Main Building",
      code: "MAIN",
    },
  });

  const annexBuilding = await prisma.building.create({
    data: {
      propertyId: property.id,
      name: "Annex",
      code: "ANNEX",
    },
  });

  const mainFloors = [];
  for (let n = 1; n <= 4; n++) {
    mainFloors.push(
      await prisma.floor.create({
        data: {
          buildingId: mainBuilding.id,
          number: n,
          name: `Floor ${n}`,
        },
      }),
    );
  }

  const annexFloors = [];
  for (let n = 1; n <= 2; n++) {
    annexFloors.push(
      await prisma.floor.create({
        data: {
          buildingId: annexBuilding.id,
          number: n,
          name: `Annex Floor ${n}`,
        },
      }),
    );
  }

  const occupancies = [
    Occupancy.vacant,
    Occupancy.occupied,
    Occupancy.vacant,
    Occupancy.unknown,
  ];
  const cleanings = [
    CleaningStatus.dirty,
    CleaningStatus.verified_clean,
    CleaningStatus.in_progress,
    CleaningStatus.pending_inspection,
    CleaningStatus.dirty,
  ];
  const services = [
    ServiceStatus.in_service,
    ServiceStatus.in_service,
    ServiceStatus.in_service,
    ServiceStatus.out_of_service,
    ServiceStatus.unknown,
  ];

  const locations = [];
  let roomIndex = 0;

  // MAIN: 10 rooms per floor × 4 = 40
  for (const floor of mainFloors) {
    for (let r = 1; r <= 10; r++) {
      const number = `${floor.number}${String(r).padStart(2, "0")}`;
      locations.push(
        await prisma.location.create({
          data: {
            floorId: floor.id,
            number,
            occupancy: cycle(occupancies, roomIndex),
            cleaningStatus: cycle(cleanings, roomIndex),
            serviceStatus: cycle(services, roomIndex),
          },
        }),
      );
      roomIndex++;
    }
  }

  // ANNEX: 5 rooms per floor × 2 = 10 → total 50 so far
  for (const floor of annexFloors) {
    for (let r = 1; r <= 5; r++) {
      const number = `A${floor.number}${String(r).padStart(2, "0")}`;
      locations.push(
        await prisma.location.create({
          data: {
            floorId: floor.id,
            number,
            occupancy: cycle(occupancies, roomIndex),
            cleaningStatus: cycle(cleanings, roomIndex),
            serviceStatus: cycle(services, roomIndex),
          },
        }),
      );
      roomIndex++;
    }
  }

  // Common areas (MAIN / ANNEX)
  const commonAreaDefs: Array<{
    floorId: string;
    number: string;
    cleaningStatus: CleaningStatus;
    serviceStatus: ServiceStatus;
  }> = [
    {
      floorId: mainFloors[0].id,
      number: "Lobby",
      cleaningStatus: CleaningStatus.dirty,
      serviceStatus: ServiceStatus.in_service,
    },
    {
      floorId: mainFloors[0].id,
      number: "Reception Hall",
      cleaningStatus: CleaningStatus.verified_clean,
      serviceStatus: ServiceStatus.in_service,
    },
    {
      floorId: mainFloors[0].id,
      number: "Restaurant",
      cleaningStatus: CleaningStatus.pending_inspection,
      serviceStatus: ServiceStatus.in_service,
    },
    {
      floorId: mainFloors[1].id,
      number: "Corridor L2",
      cleaningStatus: CleaningStatus.dirty,
      serviceStatus: ServiceStatus.in_service,
    },
    {
      floorId: mainFloors[1].id,
      number: "Gym",
      cleaningStatus: CleaningStatus.in_progress,
      serviceStatus: ServiceStatus.in_service,
    },
    {
      floorId: mainFloors[2].id,
      number: "Spa",
      cleaningStatus: CleaningStatus.verified_clean,
      serviceStatus: ServiceStatus.out_of_service,
    },
    {
      floorId: annexFloors[0].id,
      number: "Pool",
      cleaningStatus: CleaningStatus.dirty,
      serviceStatus: ServiceStatus.in_service,
    },
    {
      floorId: annexFloors[0].id,
      number: "Corridor A1",
      cleaningStatus: CleaningStatus.verified_clean,
      serviceStatus: ServiceStatus.in_service,
    },
  ];

  const commonAreas = [];
  for (const ca of commonAreaDefs) {
    commonAreas.push(
      await prisma.location.create({
        data: {
          floorId: ca.floorId,
          number: ca.number,
          kind: LocationKind.common_area,
          occupancy: Occupancy.vacant,
          cleaningStatus: ca.cleaningStatus,
          serviceStatus: ca.serviceStatus,
        },
      }),
    );
  }
  locations.push(...commonAreas);

  // ROYAL: 10 floors × 30 rooms = +300 → ~350 total (+ common areas)
  const royalBuilding = await prisma.building.create({
    data: {
      propertyId: property.id,
      name: "Royal Wing",
      code: "ROYAL",
    },
  });
  const royalFloors = [];
  for (let n = 1; n <= 10; n++) {
    royalFloors.push(
      await prisma.floor.create({
        data: {
          buildingId: royalBuilding.id,
          number: n,
          name: `Royal Floor ${n}`,
        },
      }),
    );
  }
  for (const floor of royalFloors) {
    for (let r = 1; r <= 30; r++) {
      const number = `R${floor.number}${String(r).padStart(2, "0")}`;
      locations.push(
        await prisma.location.create({
          data: {
            floorId: floor.id,
            number,
            occupancy: cycle(occupancies, roomIndex),
            cleaningStatus: cycle(cleanings, roomIndex),
            serviceStatus: cycle(services, roomIndex),
          },
        }),
      );
      roomIndex++;
    }
  }

  const passwordHash = await bcrypt.hash("demo1234", 10);

  const employees: EmpDef[] = [
    { employeeNumber: "R001", fullName: "Anna Reception", department: "Front Desk", email: "reception@meridian.local", role: Role.reception },
    { employeeNumber: "R002", fullName: "Boyan Desk", department: "Front Desk", email: "reception2@meridian.local", role: Role.reception },
    { employeeNumber: "H001", fullName: "Maria Housekeeper", department: "Housekeeping", email: "housekeeper@meridian.local", role: Role.housekeeper },
    { employeeNumber: "H002", fullName: "Elena Petrova", department: "Housekeeping", email: "elena@meridian.local", role: Role.housekeeper },
    { employeeNumber: "H003", fullName: "Nina Dimitrova", department: "Housekeeping", email: "nina@meridian.local", role: Role.housekeeper },
    { employeeNumber: "H004", fullName: "Krasimira Todorova", department: "Housekeeping", email: "krasi@meridian.local", role: Role.housekeeper },
    { employeeNumber: "H005", fullName: "Desislava Ivanova", department: "Housekeeping", email: "desi@meridian.local", role: Role.housekeeper },
    { employeeNumber: "H006", fullName: "Petya Georgieva", department: "Housekeeping", email: "petya@meridian.local", role: Role.housekeeper },
    { employeeNumber: "H007", fullName: "Vanya Stoyanova", department: "Housekeeping", email: "vanya@meridian.local", role: Role.housekeeper },
    { employeeNumber: "H008", fullName: "Silvia Angelova", department: "Housekeeping", email: "silvia@meridian.local", role: Role.housekeeper },
    { employeeNumber: "H009", fullName: "Radostina Koleva", department: "Housekeeping", email: "radost@meridian.local", role: Role.housekeeper },
    { employeeNumber: "H010", fullName: "Tanya Mihaylova", department: "Housekeeping", email: "tanya@meridian.local", role: Role.housekeeper },
    { employeeNumber: "H011", fullName: "Ivelina Hristova", department: "Housekeeping", email: "ivelina@meridian.local", role: Role.housekeeper },
    { employeeNumber: "H012", fullName: "Gergana Nikolova", department: "Housekeeping", email: "gergana@meridian.local", role: Role.housekeeper },
    { employeeNumber: "S001", fullName: "Ivan Supervisor", department: "Housekeeping", email: "supervisor@meridian.local", role: Role.supervisor },
    { employeeNumber: "S002", fullName: "Kalina Lead", department: "Housekeeping", email: "supervisor2@meridian.local", role: Role.supervisor },
    { employeeNumber: "T001", fullName: "Georgi Technician", department: "Maintenance", email: "technician@meridian.local", role: Role.technician },
    { employeeNumber: "T002", fullName: "Martin Fix", department: "Maintenance", email: "technician2@meridian.local", role: Role.technician },
    { employeeNumber: "T003", fullName: "Stefan Tools", department: "Maintenance", email: "stefan@meridian.local", role: Role.technician },
    { employeeNumber: "M001", fullName: "Petar Manager", department: "Management", email: "manager@meridian.local", role: Role.manager },
    { employeeNumber: "M002", fullName: "Victoria Owner", department: "Management", email: "manager2@meridian.local", role: Role.manager },
    { employeeNumber: "M003", fullName: "Dimitar Director", department: "Management", email: "director@meridian.local", role: Role.manager },
    { employeeNumber: "A001", fullName: "Admin User", department: "IT", email: "admin@meridian.local", role: Role.admin },
    { employeeNumber: "A002", fullName: "System Admin", department: "IT", email: "admin2@meridian.local", role: Role.admin },
    { employeeNumber: "O001", fullName: "Royal Owner", department: "Ownership", email: "owner@meridian.local", role: Role.owner },
    { employeeNumber: "H013", fullName: "Monika Vassileva", department: "Housekeeping", email: "monika@meridian.local", role: Role.housekeeper },
  ];

  const now = new Date();
  const createdEmployees: Record<string, string> = {};
  for (const emp of employees) {
    const employee = await prisma.employee.create({
      data: {
        employeeNumber: emp.employeeNumber,
        fullName: emp.fullName,
        department: emp.department,
      },
    });
    createdEmployees[emp.employeeNumber] = employee.id;
    await prisma.user.create({
      data: {
        employeeId: employee.id,
        email: emp.email,
        passwordHash,
        role: emp.role,
        activatedAt: now,
      },
    });
  }

  // Not-onboarded employees (no user yet) for Team directory filter demos
  const pendingOnlyEmployees = [
    {
      employeeNumber: "H014",
      fullName: "Yana Pending",
      department: "Housekeeping",
    },
    {
      employeeNumber: "H015",
      fullName: "Borislava Waiting",
      department: "Housekeeping",
    },
    {
      employeeNumber: "T004",
      fullName: "Nikolay Unactivated",
      department: "Maintenance",
    },
  ];
  for (const emp of pendingOnlyEmployees) {
    const employee = await prisma.employee.create({ data: emp });
    createdEmployees[emp.employeeNumber] = employee.id;
  }

  // Pending user (invited, not activated) — email reserved, password unusable until redeem
  const pendingEmployee = await prisma.employee.create({
    data: {
      employeeNumber: "H016",
      fullName: "Iva Invited",
      department: "Housekeeping",
    },
  });
  createdEmployees.H016 = pendingEmployee.id;
  const pendingUser = await prisma.user.create({
    data: {
      employeeId: pendingEmployee.id,
      email: "iva.invited@meridian.local",
      passwordHash: await bcrypt.hash(`pending-${Date.now()}`, 10),
      role: Role.housekeeper,
      activatedAt: null,
    },
  });

  const ownerUser = await prisma.user.findFirst({
    where: { email: "owner@meridian.local" },
  });
  const crypto = await import("crypto");
  if (ownerUser) {
    const code = "DEMO-ONBOARD";
    const codeHash = crypto.createHash("sha256").update(code).digest("hex");
    await prisma.invitation.create({
      data: {
        codeHash,
        codeHint: code.slice(-4),
        employeeId: pendingEmployee.id,
        role: Role.housekeeper,
        email: pendingUser.email,
        status: "issued",
        expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        createdByUserId: ownerUser.id,
      },
    });
  }

  // Extra invitations: expired / revoked (S05 lifecycle demos)
  if (ownerUser) {
    const expiredCode = "DEMO-EXPIRED";
    await prisma.invitation.create({
      data: {
        codeHash: crypto.createHash("sha256").update(expiredCode).digest("hex"),
        codeHint: expiredCode.slice(-4),
        employeeId: createdEmployees.H014,
        role: Role.housekeeper,
        email: "yana.pending@meridian.local",
        status: "expired",
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        createdByUserId: ownerUser.id,
      },
    });
    const revokedCode = "DEMO-REVOKED";
    await prisma.invitation.create({
      data: {
        codeHash: crypto.createHash("sha256").update(revokedCode).digest("hex"),
        codeHint: revokedCode.slice(-4),
        employeeId: createdEmployees.H015,
        role: Role.housekeeper,
        email: "borislava.waiting@meridian.local",
        status: "revoked",
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        revokedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        createdByUserId: ownerUser.id,
      },
    });
  }

  const { ensureDefaultMaintenanceCatalog, categorySnapshotFromKey } =
    await import("../src/services/issueCatalog");
  const { IssueOptionKind } = await import("@prisma/client");
  const { byKey: categoryByKey } = await ensureDefaultMaintenanceCatalog();

  // Extra issue options beyond defaults (S10 catalog density)
  const extraOptions: Array<{
    categoryKey: string;
    kind: (typeof IssueOptionKind)[keyof typeof IssueOptionKind];
    nameBg: string;
    nameEn: string;
    defaultPriority?: Priority;
    defaultBlocksRoom?: boolean;
    sortOrder: number;
  }> = [
    {
      categoryKey: "climate",
      kind: IssueOptionKind.maintenance,
      nameBg: "Климатикът не духа",
      nameEn: "AC no airflow",
      defaultPriority: Priority.high,
      defaultBlocksRoom: true,
      sortOrder: 10,
    },
    {
      categoryKey: "climate",
      kind: IssueOptionKind.maintenance,
      nameBg: "Дистанционно липсва",
      nameEn: "Remote missing",
      defaultPriority: Priority.low,
      defaultBlocksRoom: false,
      sortOrder: 11,
    },
    {
      categoryKey: "plumbing",
      kind: IssueOptionKind.maintenance,
      nameBg: "Слаб напор на душа",
      nameEn: "Weak shower pressure",
      defaultPriority: Priority.normal,
      defaultBlocksRoom: false,
      sortOrder: 10,
    },
    {
      categoryKey: "plumbing",
      kind: IssueOptionKind.maintenance,
      nameBg: "Тоалетна прелива",
      nameEn: "Toilet overflowing",
      defaultPriority: Priority.urgent,
      defaultBlocksRoom: true,
      sortOrder: 11,
    },
    {
      categoryKey: "electrical",
      kind: IssueOptionKind.maintenance,
      nameBg: "TV не се включва",
      nameEn: "TV won't turn on",
      defaultPriority: Priority.normal,
      defaultBlocksRoom: false,
      sortOrder: 10,
    },
    {
      categoryKey: "electrical",
      kind: IssueOptionKind.maintenance,
      nameBg: "Ключ за осветление счупен",
      nameEn: "Light switch broken",
      defaultPriority: Priority.high,
      defaultBlocksRoom: false,
      sortOrder: 11,
    },
    {
      categoryKey: "furniture",
      kind: IssueOptionKind.maintenance,
      nameBg: "Матрак с пружина",
      nameEn: "Mattress spring issue",
      defaultPriority: Priority.high,
      defaultBlocksRoom: true,
      sortOrder: 10,
    },
    {
      categoryKey: "furniture",
      kind: IssueOptionKind.maintenance,
      nameBg: "Заседнал чекмедже",
      nameEn: "Stuck drawer",
      defaultPriority: Priority.low,
      defaultBlocksRoom: false,
      sortOrder: 11,
    },
    {
      categoryKey: "other",
      kind: IssueOptionKind.housekeeping,
      nameBg: "Липсват хавлии",
      nameEn: "Towels missing",
      defaultPriority: Priority.normal,
      defaultBlocksRoom: false,
      sortOrder: 10,
    },
    {
      categoryKey: "other",
      kind: IssueOptionKind.housekeeping,
      nameBg: "Мръсни пердета",
      nameEn: "Dirty curtains",
      defaultPriority: Priority.low,
      defaultBlocksRoom: false,
      sortOrder: 11,
    },
    {
      categoryKey: "other",
      kind: IssueOptionKind.housekeeping,
      nameBg: "Минибар празен / грешен",
      nameEn: "Minibar empty / wrong",
      defaultPriority: Priority.normal,
      defaultBlocksRoom: false,
      sortOrder: 12,
    },
    {
      categoryKey: "other",
      kind: IssueOptionKind.maintenance,
      nameBg: "Ключалка на вратата заседнала",
      nameEn: "Door lock stuck",
      defaultPriority: Priority.urgent,
      defaultBlocksRoom: true,
      sortOrder: 13,
    },
  ];
  for (const opt of extraOptions) {
    const cat = categoryByKey[opt.categoryKey];
    if (!cat) continue;
    await prisma.issueOption.create({
      data: {
        maintenanceCategoryId: cat.id,
        kind: opt.kind,
        nameBg: opt.nameBg,
        nameEn: opt.nameEn,
        defaultPriority: opt.defaultPriority,
        defaultBlocksRoom: opt.defaultBlocksRoom,
        sortOrder: opt.sortOrder,
      },
    });
  }
  const allIssueOptions = await prisma.issueOption.findMany({
    include: { maintenanceCategory: true },
    orderBy: [{ sortOrder: "asc" }],
  });
  const optionByNameEn = new Map(
    allIssueOptions.map((o) => [o.nameEn, o] as const),
  );
  console.log(
    `Issue catalog: ${allIssueOptions.length} options (${extraOptions.length} extra)`,
  );

  const slaHoursByPriority: Record<Priority, number> = {
    [Priority.low]: 72,
    [Priority.normal]: 24,
    [Priority.high]: 8,
    [Priority.urgent]: 4,
  };
  const slaPolicies: Record<Priority, { id: string; hours: number }> = {} as Record<
    Priority,
    { id: string; hours: number }
  >;
  for (const priority of Object.values(Priority)) {
    const hours = slaHoursByPriority[priority];
    const policy = await prisma.slaPolicy.upsert({
      where: { priority },
      create: { priority, hours, isActive: true },
      update: { hours, isActive: true },
    });
    slaPolicies[priority] = { id: policy.id, hours };
  }

  async function seedTicketEvents(
    ticketId: string,
    chain: Array<{
      from: TicketStatus | null;
      to: TicketStatus;
      actor: string;
      hoursAfterOpen: number;
      reason?: string;
    }>,
    openedAt: Date,
  ) {
    for (const step of chain) {
      await prisma.ticketEvent.create({
        data: {
          ticketId,
          fromStatus: step.from ?? undefined,
          toStatus: step.to,
          actorEmployeeId: createdEmployees[step.actor],
          reason: step.reason,
          occurredAt: new Date(
            openedAt.getTime() + step.hoursAfterOpen * 60 * 60 * 1000,
          ),
        },
      });
    }
  }

  const ticketDefs: Array<{
    number: string;
    title: string;
    categoryKey: string;
    priority: Priority;
    blocksRoom: boolean;
    reporter: string;
    assignee?: string;
    status?: TicketStatus;
    optionNameEn?: string;
  }> = [
    { number: "104", title: "AC leak under window", categoryKey: "climate", priority: Priority.high, blocksRoom: true, reporter: "R001", assignee: "T001", status: TicketStatus.assigned, optionNameEn: "AC leak" },
    { number: "102", title: "Loose bathroom tap", categoryKey: "plumbing", priority: Priority.low, blocksRoom: false, reporter: "H001", optionNameEn: "Leaking tap" },
    { number: "208", title: "No power at desk sockets", categoryKey: "electrical", priority: Priority.urgent, blocksRoom: true, reporter: "R002", assignee: "T002", status: TicketStatus.in_progress, optionNameEn: "No power at sockets" },
    { number: "305", title: "Broken wardrobe hinge", categoryKey: "furniture", priority: Priority.normal, blocksRoom: false, reporter: "H003", assignee: "T001", status: TicketStatus.waiting, optionNameEn: "Broken furniture" },
    { number: "401", title: "Strong mold smell in bath", categoryKey: "other", priority: Priority.high, blocksRoom: true, reporter: "S001", assignee: "T002", status: TicketStatus.in_progress, optionNameEn: "Stain / odor" },
    { number: "A101", title: "Annex AC not cooling", categoryKey: "climate", priority: Priority.high, blocksRoom: true, reporter: "H005", optionNameEn: "AC not cooling" },
    { number: "A205", title: "Flickering bathroom light", categoryKey: "electrical", priority: Priority.normal, blocksRoom: false, reporter: "T001", assignee: "T001", status: TicketStatus.assigned, optionNameEn: "Flickering light" },
    { number: "109", title: "Clogged sink", categoryKey: "plumbing", priority: Priority.urgent, blocksRoom: true, reporter: "H002", assignee: "T002", status: TicketStatus.in_progress, optionNameEn: "Clogged sink" },
    { number: "207", title: "Chair leg cracked", categoryKey: "furniture", priority: Priority.low, blocksRoom: false, reporter: "H007", optionNameEn: "Broken furniture" },
    { number: "410", title: "Window seal damaged", categoryKey: "other", priority: Priority.normal, blocksRoom: false, reporter: "M001" },
    // Owner My Work demos (assignee O001)
    { number: "106", title: "Owner walkthrough — dripping faucet", categoryKey: "plumbing", priority: Priority.high, blocksRoom: false, reporter: "R001", assignee: "O001", status: TicketStatus.assigned, optionNameEn: "Leaking tap" },
    { number: "204", title: "Owner walkthrough — AC noise", categoryKey: "climate", priority: Priority.urgent, blocksRoom: true, reporter: "S001", assignee: "O001", status: TicketStatus.in_progress, optionNameEn: "AC leak" },
    { number: "Corridor L2", title: "Owner walkthrough — corridor light out", categoryKey: "electrical", priority: Priority.normal, blocksRoom: false, reporter: "H001", assignee: "O001", status: TicketStatus.assigned, optionNameEn: "Flickering light" },
    { number: "R101", title: "Royal suite balcony door stuck", categoryKey: "furniture", priority: Priority.high, blocksRoom: true, reporter: "O001", assignee: "T001", status: TicketStatus.assigned, optionNameEn: "Stuck drawer" },
    { number: "R515", title: "Royal wing spa pump noise", categoryKey: "plumbing", priority: Priority.normal, blocksRoom: false, reporter: "M002", optionNameEn: "Weak shower pressure" },
    { number: "Pool", title: "Pool filter clogged", categoryKey: "plumbing", priority: Priority.urgent, blocksRoom: true, reporter: "T001", assignee: "T002", status: TicketStatus.in_progress, optionNameEn: "Clogged sink" },
    { number: "Lobby", title: "Lobby carpet stain", categoryKey: "other", priority: Priority.normal, blocksRoom: false, reporter: "H001", optionNameEn: "Stain / odor" },
    { number: "Spa", title: "Spa steam generator fault", categoryKey: "electrical", priority: Priority.high, blocksRoom: true, reporter: "T002", assignee: "T001", status: TicketStatus.waiting, optionNameEn: "No power at sockets" },
    { number: "R218", title: "TV won't turn on — Royal", categoryKey: "electrical", priority: Priority.normal, blocksRoom: false, reporter: "R001", assignee: "T003", status: TicketStatus.assigned, optionNameEn: "TV won't turn on" },
    { number: "R330", title: "Toilet overflowing", categoryKey: "plumbing", priority: Priority.urgent, blocksRoom: true, reporter: "H008", assignee: "T001", status: TicketStatus.in_progress, optionNameEn: "Toilet overflowing" },
    { number: "R712", title: "Door lock stuck", categoryKey: "other", priority: Priority.urgent, blocksRoom: true, reporter: "R002", assignee: "T002", status: TicketStatus.assigned, optionNameEn: "Door lock stuck" },
    { number: "R901", title: "Mattress spring complaint", categoryKey: "furniture", priority: Priority.high, blocksRoom: true, reporter: "S002", assignee: "T003", status: TicketStatus.waiting, optionNameEn: "Mattress spring issue" },
    { number: "Gym", title: "Gym AC no airflow", categoryKey: "climate", priority: Priority.high, blocksRoom: false, reporter: "M001", assignee: "T001", status: TicketStatus.in_progress, optionNameEn: "AC no airflow" },
    { number: "Restaurant", title: "Restaurant light switch broken", categoryKey: "electrical", priority: Priority.high, blocksRoom: false, reporter: "H004", assignee: "T002", status: TicketStatus.assigned, optionNameEn: "Light switch broken" },
    { number: "A104", title: "Towels missing after clean", categoryKey: "other", priority: Priority.normal, blocksRoom: false, reporter: "S001", optionNameEn: "Towels missing" },
    { number: "R405", title: "Minibar stock wrong", categoryKey: "other", priority: Priority.low, blocksRoom: false, reporter: "H009", optionNameEn: "Minibar empty / wrong" },
    { number: "308", title: "Remote missing", categoryKey: "climate", priority: Priority.low, blocksRoom: false, reporter: "H010", optionNameEn: "Remote missing" },
    { number: "R1025", title: "Dirty curtains — penthouse", categoryKey: "other", priority: Priority.low, blocksRoom: false, reporter: "H011", optionNameEn: "Dirty curtains" },
  ];

  let liveTicketsCreated = 0;
  for (const t of ticketDefs) {
    const loc = locations.find((l) => l.number === t.number);
    if (!loc) continue;
    const snap = categorySnapshotFromKey(categoryByKey, t.categoryKey);
    const policy = slaPolicies[t.priority];
    const hours = policy.hours;
    const status = t.status ?? TicketStatus.new;
    const option = t.optionNameEn
      ? optionByNameEn.get(t.optionNameEn)
      : undefined;
    const openedAt = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const ticket = await prisma.maintenanceTicket.create({
      data: {
        locationId: loc.id,
        title: t.title,
        issueOptionId: option?.id,
        maintenanceCategoryId: snap.maintenanceCategoryId,
        categoryKey: snap.categoryKey,
        categoryLabelBg: snap.categoryLabelBg,
        categoryLabelEn: snap.categoryLabelEn,
        priority: t.priority,
        blocksRoom: t.blocksRoom,
        status,
        reportedByEmployeeId: createdEmployees[t.reporter],
        assigneeId: t.assignee ? createdEmployees[t.assignee] : undefined,
        slaPolicyId: policy.id,
        slaHoursSnapshot: hours,
        openedAt,
        dueAt: new Date(Date.now() + (t.blocksRoom ? -2 : hours) * 60 * 60 * 1000),
        slaPausedAt: status === TicketStatus.waiting ? new Date() : undefined,
      },
    });
    liveTicketsCreated += 1;

    const chain: Array<{
      from: TicketStatus | null;
      to: TicketStatus;
      actor: string;
      hoursAfterOpen: number;
      reason?: string;
    }> = [
      {
        from: null,
        to: TicketStatus.new,
        actor: t.reporter,
        hoursAfterOpen: 0,
        reason: "Ticket opened",
      },
    ];
    if (
      status === TicketStatus.assigned ||
      status === TicketStatus.in_progress ||
      status === TicketStatus.waiting
    ) {
      chain.push({
        from: TicketStatus.new,
        to: TicketStatus.assigned,
        actor: t.assignee ?? "S001",
        hoursAfterOpen: 0.5,
        reason: "Assigned to technician",
      });
    }
    if (status === TicketStatus.in_progress || status === TicketStatus.waiting) {
      chain.push({
        from: TicketStatus.assigned,
        to: TicketStatus.in_progress,
        actor: t.assignee ?? "T001",
        hoursAfterOpen: 1,
        reason: "Work started",
      });
    }
    if (status === TicketStatus.waiting) {
      chain.push({
        from: TicketStatus.in_progress,
        to: TicketStatus.waiting,
        actor: t.assignee ?? "T001",
        hoursAfterOpen: 2,
        reason: "Waiting on parts",
      });
    }
    await seedTicketEvents(ticket.id, chain, openedAt);
  }
  console.log(`Live tickets seeded: ${liveTicketsCreated}`);

  // Historical resolved / reopened / closed tickets for Analytics (S14)
  const historyTicketDefs: Array<{
    number: string;
    title: string;
    categoryKey: string;
    priority: Priority;
    daysAgo: number;
    resolveHours: number;
    slaHours: number;
    reopen?: boolean;
    close?: boolean;
    optionNameEn?: string;
  }> = [
    {
      number: "104",
      title: "Repeat AC drip (resolved)",
      categoryKey: "climate",
      priority: Priority.high,
      daysAgo: 3,
      resolveHours: 30,
      slaHours: 24,
      reopen: true,
      optionNameEn: "AC leak",
    },
    {
      number: "104",
      title: "AC filter clogged again",
      categoryKey: "climate",
      priority: Priority.normal,
      daysAgo: 1,
      resolveHours: 8,
      slaHours: 24,
      optionNameEn: "AC not cooling",
    },
    {
      number: "102",
      title: "Tap washer replaced",
      categoryKey: "plumbing",
      priority: Priority.low,
      daysAgo: 5,
      resolveHours: 6,
      slaHours: 24,
      close: true,
      optionNameEn: "Leaking tap",
    },
    {
      number: "208",
      title: "Desk socket wiring fixed",
      categoryKey: "electrical",
      priority: Priority.urgent,
      daysAgo: 2,
      resolveHours: 40,
      slaHours: 12,
      optionNameEn: "No power at sockets",
    },
    {
      number: "305",
      title: "Wardrobe hinge replaced",
      categoryKey: "furniture",
      priority: Priority.normal,
      daysAgo: 6,
      resolveHours: 10,
      slaHours: 24,
      close: true,
      optionNameEn: "Broken furniture",
    },
    {
      number: "Lobby",
      title: "Lobby carpet cleaned",
      categoryKey: "other",
      priority: Priority.normal,
      daysAgo: 4,
      resolveHours: 5,
      slaHours: 24,
      close: true,
      optionNameEn: "Stain / odor",
    },
    {
      number: "A101",
      title: "Annex AC serviced",
      categoryKey: "climate",
      priority: Priority.high,
      daysAgo: 7,
      resolveHours: 18,
      slaHours: 24,
      optionNameEn: "AC not cooling",
    },
    {
      number: "109",
      title: "Sink unclogged",
      categoryKey: "plumbing",
      priority: Priority.urgent,
      daysAgo: 1,
      resolveHours: 3,
      slaHours: 8,
      optionNameEn: "Clogged sink",
    },
    {
      number: "R220",
      title: "Royal TV replaced",
      categoryKey: "electrical",
      priority: Priority.normal,
      daysAgo: 8,
      resolveHours: 12,
      slaHours: 24,
      close: true,
      optionNameEn: "TV won't turn on",
    },
    {
      number: "R610",
      title: "Shower pressure restored",
      categoryKey: "plumbing",
      priority: Priority.normal,
      daysAgo: 9,
      resolveHours: 20,
      slaHours: 24,
      optionNameEn: "Weak shower pressure",
    },
    {
      number: "R815",
      title: "Door lock repaired then reopened",
      categoryKey: "other",
      priority: Priority.urgent,
      daysAgo: 4,
      resolveHours: 6,
      slaHours: 4,
      reopen: true,
      optionNameEn: "Door lock stuck",
    },
    {
      number: "Gym",
      title: "Gym AC filter cleaned",
      categoryKey: "climate",
      priority: Priority.high,
      daysAgo: 10,
      resolveHours: 14,
      slaHours: 8,
      close: true,
      optionNameEn: "AC no airflow",
    },
    {
      number: "R1015",
      title: "Penthouse mattress swapped",
      categoryKey: "furniture",
      priority: Priority.high,
      daysAgo: 11,
      resolveHours: 28,
      slaHours: 8,
      close: true,
      optionNameEn: "Mattress spring issue",
    },
  ];

  let historyTickets = 0;
  let reopenCount = 0;
  let closedCount = 0;
  for (const ht of historyTicketDefs) {
    const loc = locations.find((l) => l.number === ht.number);
    if (!loc) continue;
    const openedAt = new Date(
      Date.now() - ht.daysAgo * 24 * 60 * 60 * 1000,
    );
    const dueAt = new Date(openedAt.getTime() + ht.slaHours * 60 * 60 * 1000);
    const resolvedAt = new Date(
      openedAt.getTime() + ht.resolveHours * 60 * 60 * 1000,
    );
    const snap = categorySnapshotFromKey(categoryByKey, ht.categoryKey);
    const policy = slaPolicies[ht.priority];
    const option = ht.optionNameEn
      ? optionByNameEn.get(ht.optionNameEn)
      : undefined;
    const finalStatus = ht.close
      ? TicketStatus.closed
      : ht.reopen
        ? TicketStatus.in_progress
        : TicketStatus.resolved;
    const ticket = await prisma.maintenanceTicket.create({
      data: {
        locationId: loc.id,
        title: ht.title,
        issueOptionId: option?.id,
        maintenanceCategoryId: snap.maintenanceCategoryId,
        categoryKey: snap.categoryKey,
        categoryLabelBg: snap.categoryLabelBg,
        categoryLabelEn: snap.categoryLabelEn,
        priority: ht.priority,
        blocksRoom: false,
        status: finalStatus === TicketStatus.in_progress && ht.reopen
          ? TicketStatus.resolved
          : finalStatus === TicketStatus.closed
            ? TicketStatus.closed
            : TicketStatus.resolved,
        reportedByEmployeeId: createdEmployees.R001,
        resolvedByEmployeeId: createdEmployees.T001,
        assigneeId: createdEmployees.T001,
        openedAt,
        dueAt,
        slaPolicyId: policy.id,
        slaHoursSnapshot: ht.slaHours,
        resolvedAt: ht.reopen ? resolvedAt : resolvedAt,
        resolutionNotes: "Seeded resolution",
        closedAt: ht.close
          ? new Date(resolvedAt.getTime() + 2 * 60 * 60 * 1000)
          : undefined,
        closedByEmployeeId: ht.close ? createdEmployees.S001 : undefined,
      },
    });
    historyTickets += 1;

    await seedTicketEvents(
      ticket.id,
      [
        {
          from: null,
          to: TicketStatus.new,
          actor: "R001",
          hoursAfterOpen: 0,
        },
        {
          from: TicketStatus.new,
          to: TicketStatus.assigned,
          actor: "S001",
          hoursAfterOpen: 0.5,
        },
        {
          from: TicketStatus.assigned,
          to: TicketStatus.in_progress,
          actor: "T001",
          hoursAfterOpen: 1,
        },
        {
          from: TicketStatus.in_progress,
          to: TicketStatus.resolved,
          actor: "T001",
          hoursAfterOpen: ht.resolveHours,
          reason: "Seeded resolution",
        },
        ...(ht.close
          ? [
              {
                from: TicketStatus.resolved,
                to: TicketStatus.closed,
                actor: "S001",
                hoursAfterOpen: ht.resolveHours + 2,
                reason: "Closed after verification",
              },
            ]
          : []),
      ],
      openedAt,
    );

    if (ht.close) closedCount += 1;

    if (ht.reopen) {
      await prisma.ticketReopenEvent.create({
        data: {
          ticketId: ticket.id,
          reopenedAt: new Date(resolvedAt.getTime() + 6 * 60 * 60 * 1000),
          reopenedByEmployeeId: createdEmployees.S001,
          reason: "Guest reported recurrence",
          previousStatus: TicketStatus.resolved,
        },
      });
      await prisma.maintenanceTicket.update({
        where: { id: ticket.id },
        data: {
          status: TicketStatus.in_progress,
          resolvedAt: null,
          resolvedByEmployeeId: null,
          resolutionNotes: null,
          closedAt: null,
          closedByEmployeeId: null,
        },
      });
      await prisma.ticketEvent.create({
        data: {
          ticketId: ticket.id,
          fromStatus: TicketStatus.resolved,
          toStatus: TicketStatus.in_progress,
          actorEmployeeId: createdEmployees.S001,
          reason: "Guest reported recurrence",
          occurredAt: new Date(resolvedAt.getTime() + 6 * 60 * 60 * 1000),
        },
      });
      reopenCount += 1;
    }
  }
  console.log(
    `Analytics tickets seeded: ${historyTickets} historical, ${reopenCount} reopened, ${closedCount} closed`,
  );

  const dirtyVacant = locations.find(
    (l) =>
      l.kind === LocationKind.room &&
      (l.number === "101" ||
        (l.cleaningStatus === CleaningStatus.dirty &&
          l.occupancy === Occupancy.vacant &&
          l.serviceStatus === ServiceStatus.in_service)),
  );
  if (dirtyVacant) {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    await prisma.cleaningTask.create({
      data: {
        locationId: dirtyVacant.id,
        hotelDate: today,
        priority: Priority.high,
        assignedEmployeeId: createdEmployees.H001,
        status: TaskStatus.assigned,
        dueAt: new Date(Date.now() + 4 * 60 * 60 * 1000),
      },
    });
  }

  // Owner My Work demos — cleaning tasks assigned to O001 for today
  {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const ownerDemoRooms = ["107", "202", "304"];
    for (const [i, number] of ownerDemoRooms.entries()) {
      const loc = locations.find((l) => l.number === number);
      if (!loc) continue;
      await prisma.cleaningTask.create({
        data: {
          locationId: loc.id,
          hotelDate: today,
          priority: i === 0 ? Priority.urgent : Priority.high,
          assignedEmployeeId: createdEmployees.O001,
          status: i === 1 ? TaskStatus.in_progress : TaskStatus.assigned,
          dueAt: new Date(Date.now() + (2 + i) * 60 * 60 * 1000),
        },
      });
    }
    const ownerInProgress = await prisma.cleaningTask.findFirst({
      where: {
        assignedEmployeeId: createdEmployees.O001,
        status: TaskStatus.in_progress,
        hotelDate: today,
      },
    });
    if (ownerInProgress) {
      await prisma.cleaningSession.create({
        data: {
          taskId: ownerInProgress.id,
          employeeId: createdEmployees.O001,
          status: SessionStatus.running,
          startedAt: new Date(Date.now() - 25 * 60 * 1000),
          startCommandId: randomUUID(),
        },
      });
    }
  }

  const pending = locations.find(
    (l) =>
      l.kind === LocationKind.room &&
      l.cleaningStatus === CleaningStatus.pending_inspection,
  );
  if (pending) {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    await prisma.cleaningTask.create({
      data: {
        locationId: pending.id,
        hotelDate: today,
        priority: Priority.normal,
        assignedEmployeeId: createdEmployees.H002,
        status: TaskStatus.awaiting_inspection,
      },
    });
  }

  const dirtyLobby = commonAreas.find((l) => l.number === "Lobby");
  if (dirtyLobby) {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    await prisma.cleaningTask.create({
      data: {
        locationId: dirtyLobby.id,
        hotelDate: today,
        priority: Priority.normal,
        assignedEmployeeId: createdEmployees.H003,
        status: TaskStatus.assigned,
        dueAt: new Date(Date.now() + 3 * 60 * 60 * 1000),
      },
    });
  }

  const pendingRestaurant = commonAreas.find((l) => l.number === "Restaurant");
  if (pendingRestaurant) {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    await prisma.cleaningTask.create({
      data: {
        locationId: pendingRestaurant.id,
        hotelDate: today,
        priority: Priority.high,
        assignedEmployeeId: createdEmployees.H004,
        status: TaskStatus.awaiting_inspection,
      },
    });
  }

  // Live board (S09) — running / overdue / anomaly + just-completed demos
  const todayHotel = new Date();
  todayHotel.setUTCHours(0, 0, 0, 0);
  const liveSessionDefs: Array<{
    number: string;
    hk: string;
    startedAgoMinutes: number;
    alsoCompleteRecent?: boolean;
  }> = [
    { number: "105", hk: "H005", startedAgoMinutes: 35 },
    { number: "203", hk: "H006", startedAgoMinutes: 300 },
    { number: "306", hk: "H007", startedAgoMinutes: 20_000 },
  ];
  let liveRunning = 0;
  for (const def of liveSessionDefs) {
    const loc = locations.find((l) => l.number === def.number);
    const employeeId = createdEmployees[def.hk];
    if (!loc || !employeeId) continue;
    const startedAt = new Date(Date.now() - def.startedAgoMinutes * 60 * 1000);
    const task = await prisma.cleaningTask.create({
      data: {
        locationId: loc.id,
        hotelDate: todayHotel,
        priority: Priority.normal,
        assignedEmployeeId: employeeId,
        status: TaskStatus.in_progress,
        dueAt: new Date(Date.now() - 30 * 60 * 1000),
      },
    });
    await prisma.cleaningSession.create({
      data: {
        taskId: task.id,
        employeeId,
        startedAt,
        status: SessionStatus.running,
        startCommandId: randomUUID(),
      },
    });
    await prisma.location.update({
      where: { id: loc.id },
      data: { cleaningStatus: CleaningStatus.in_progress },
    });
    liveRunning += 1;
  }

  const recentLoc = locations.find((l) => l.number === "110");
  if (recentLoc && createdEmployees.H008) {
    const finishedAt = new Date(Date.now() - 18 * 60 * 1000);
    const startedAt = new Date(finishedAt.getTime() - 22 * 60 * 1000);
    const task = await prisma.cleaningTask.create({
      data: {
        locationId: recentLoc.id,
        hotelDate: todayHotel,
        priority: Priority.normal,
        assignedEmployeeId: createdEmployees.H008,
        status: TaskStatus.awaiting_inspection,
        dueAt: new Date(finishedAt.getTime() + 30 * 60 * 1000),
      },
    });
    await prisma.cleaningSession.create({
      data: {
        taskId: task.id,
        employeeId: createdEmployees.H008,
        startedAt,
        finishedAt,
        status: SessionStatus.completed,
        startCommandId: randomUUID(),
        completeCommandId: randomUUID(),
      },
    });
    await prisma.location.update({
      where: { id: recentLoc.id },
      data: { cleaningStatus: CleaningStatus.pending_inspection },
    });
  }

  const recentLoc2 = locations.find((l) => l.number === "204");
  if (recentLoc2 && createdEmployees.H009) {
    const finishedAt = new Date(Date.now() - 42 * 60 * 1000);
    const startedAt = new Date(finishedAt.getTime() - 28 * 60 * 1000);
    const task = await prisma.cleaningTask.create({
      data: {
        locationId: recentLoc2.id,
        hotelDate: todayHotel,
        priority: Priority.high,
        assignedEmployeeId: createdEmployees.H009,
        status: TaskStatus.completed,
        completedAt: new Date(finishedAt.getTime() + 5 * 60 * 1000),
        serviceType: "stayover",
        dueAt: finishedAt,
      },
    });
    await prisma.cleaningSession.create({
      data: {
        taskId: task.id,
        employeeId: createdEmployees.H009,
        startedAt,
        finishedAt,
        status: SessionStatus.completed,
        startCommandId: randomUUID(),
        completeCommandId: randomUUID(),
      },
    });
    await prisma.inspection.create({
      data: {
        taskId: task.id,
        inspectorEmployeeId: createdEmployees.S001,
        inspectedAt: new Date(finishedAt.getTime() + 5 * 60 * 1000),
        result: "approved",
        commandId: randomUUID(),
      },
    });
  }

  console.log(`Live board seed: ${liveRunning} running sessions + recent completes`);

  // Extra live sessions on Royal / Annex + anomaly flags
  const extraLiveDefs: Array<{
    number: string;
    hk: string;
    startedAgoMinutes: number;
    anomaly?: string[];
  }> = [
    { number: "R112", hk: "H010", startedAgoMinutes: 45 },
    { number: "R420", hk: "H011", startedAgoMinutes: 520, anomaly: ["long_running"] },
    { number: "A103", hk: "H012", startedAgoMinutes: 55 },
    { number: "R805", hk: "H013", startedAgoMinutes: 12_000, anomaly: ["stale_session"] },
  ];
  let extraLive = 0;
  for (const def of extraLiveDefs) {
    const loc = locations.find((l) => l.number === def.number);
    const employeeId = createdEmployees[def.hk];
    if (!loc || !employeeId) continue;
    const startedAt = new Date(Date.now() - def.startedAgoMinutes * 60 * 1000);
    const task = await prisma.cleaningTask.create({
      data: {
        locationId: loc.id,
        hotelDate: todayHotel,
        priority: Priority.normal,
        assignedEmployeeId: employeeId,
        status: TaskStatus.in_progress,
        dueAt: new Date(Date.now() - 20 * 60 * 1000),
      },
    });
    await prisma.cleaningSession.create({
      data: {
        taskId: task.id,
        employeeId,
        startedAt,
        status: SessionStatus.running,
        startCommandId: randomUUID(),
        anomalyFlags: def.anomaly ?? [],
      },
    });
    await prisma.location.update({
      where: { id: loc.id },
      data: { cleaningStatus: CleaningStatus.in_progress },
    });
    extraLive += 1;
  }
  console.log(`Extra live sessions seeded: ${extraLive}`);

  // Rework + cancelled task demos (109 — free of other active tasks today)
  const reworkLoc = locations.find((l) => l.number === "109");
  if (reworkLoc && createdEmployees.H001) {
    await prisma.cleaningTask.create({
      data: {
        locationId: reworkLoc.id,
        hotelDate: todayHotel,
        priority: Priority.high,
        assignedEmployeeId: createdEmployees.H001,
        status: TaskStatus.rework,
        reassignReason: "Rejected inspection — dust on headboard",
        dueAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      },
    });
  }
  const cancelLoc = locations.find((l) => l.number === "R201");
  if (cancelLoc && createdEmployees.H002) {
    await prisma.cleaningTask.create({
      data: {
        locationId: cancelLoc.id,
        hotelDate: todayHotel,
        priority: Priority.low,
        assignedEmployeeId: createdEmployees.H002,
        status: TaskStatus.cancelled,
        reassignReason: "Guest extended stay — cleaning cancelled",
      },
    });
  }
  console.log("Rework/cancelled task demos seeded");

  // Historical completed sessions for Results (S07–S08) demo metrics
  const hkNumbers = [
    "H001",
    "H002",
    "H003",
    "H004",
    "H005",
    "H006",
    "H007",
    "H008",
    "H009",
    "H010",
    "H011",
    "H012",
    "H013",
  ];
  const roomLocations = locations.filter((l) => l.kind === LocationKind.room);
  let historySessions = 0;
  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    const hotelDate = new Date();
    hotelDate.setUTCHours(0, 0, 0, 0);
    hotelDate.setUTCDate(hotelDate.getUTCDate() - dayOffset);

    const sessionsThisDay = dayOffset === 0 ? 8 : 8 + (dayOffset % 4);
    for (let i = 0; i < sessionsThisDay; i++) {
      const hk = hkNumbers[(dayOffset * 3 + i) % hkNumbers.length];
      const loc =
        roomLocations[(dayOffset * 11 + i * 7) % roomLocations.length];
      const employeeId = createdEmployees[hk];
      if (!loc || !employeeId) continue;

      const hour = 7 + ((i * 2 + dayOffset) % 10);
      const durationMin = 18 + ((i * 5 + dayOffset * 3) % 35);
      const late = (i + dayOffset) % 5 === 0;
      const finishedAt = new Date(hotelDate);
      finishedAt.setUTCHours(hour, (i * 7) % 60, 0, 0);
      const startedAt = new Date(finishedAt.getTime() - durationMin * 60 * 1000);
      const dueAt = new Date(
        finishedAt.getTime() + (late ? -20 : 40) * 60 * 1000,
      );

      const serviceTypes = ["stayover", "departure", "arrival"] as const;
      const task = await prisma.cleaningTask.create({
        data: {
          locationId: loc.id,
          hotelDate,
          priority: Priority.normal,
          assignedEmployeeId: employeeId,
          status: TaskStatus.completed,
          completedAt: finishedAt,
          serviceType: serviceTypes[(dayOffset + i) % serviceTypes.length],
          dueAt,
        },
      });

      await prisma.cleaningSession.create({
        data: {
          taskId: task.id,
          employeeId,
          startedAt,
          finishedAt,
          status: SessionStatus.completed,
          startCommandId: randomUUID(),
          completeCommandId: randomUUID(),
          anomalyFlags:
            (i + dayOffset) % 11 === 0 ? ["overdue"] : [],
        },
      });
      historySessions += 1;
    }
  }

  // Rejected inspections for audit findings / risk rooms
  let rejectedInspections = 0;
  for (let i = 0; i < 6; i++) {
    const loc = roomLocations[(i * 13) % roomLocations.length];
    const hk = hkNumbers[i % hkNumbers.length];
    const employeeId = createdEmployees[hk];
    if (!loc || !employeeId) continue;
    const hotelDate = new Date();
    hotelDate.setUTCHours(0, 0, 0, 0);
    hotelDate.setUTCDate(hotelDate.getUTCDate() - (i % 4));
    const finishedAt = new Date(hotelDate);
    finishedAt.setUTCHours(10 + i, 0, 0, 0);
    const startedAt = new Date(finishedAt.getTime() - 25 * 60 * 1000);

    const task = await prisma.cleaningTask.create({
      data: {
        locationId: loc.id,
        hotelDate,
        priority: Priority.normal,
        assignedEmployeeId: employeeId,
        status: TaskStatus.completed,
        completedAt: finishedAt,
        serviceType: i % 2 === 0 ? "departure" : "stayover",
        dueAt: new Date(finishedAt.getTime() + 30 * 60 * 1000),
      },
    });
    await prisma.cleaningSession.create({
      data: {
        taskId: task.id,
        employeeId,
        startedAt,
        finishedAt,
        status: SessionStatus.completed,
        startCommandId: randomUUID(),
        completeCommandId: randomUUID(),
      },
    });
    await prisma.inspection.create({
      data: {
        taskId: task.id,
        inspectorEmployeeId: createdEmployees.S001,
        inspectedAt: new Date(finishedAt.getTime() + 20 * 60 * 1000),
        result: InspectionResult.rejected,
        findings: i % 2 === 0 ? "Dust on headboard" : "Bathroom mirror streaked",
        commandId: randomUUID(),
      },
    });
    rejectedInspections += 1;
  }
  // Double-reject same room for risk threshold
  {
    const loc = roomLocations[0];
    const employeeId = createdEmployees.H001;
    if (loc && employeeId) {
      const hotelDate = new Date();
      hotelDate.setUTCHours(0, 0, 0, 0);
      hotelDate.setUTCDate(hotelDate.getUTCDate() - 1);
      const finishedAt = new Date(hotelDate);
      finishedAt.setUTCHours(15, 0, 0, 0);
      const task = await prisma.cleaningTask.create({
        data: {
          locationId: loc.id,
          hotelDate,
          priority: Priority.high,
          assignedEmployeeId: employeeId,
          status: TaskStatus.completed,
          completedAt: finishedAt,
          serviceType: "departure",
        },
      });
      await prisma.cleaningSession.create({
        data: {
          taskId: task.id,
          employeeId,
          startedAt: new Date(finishedAt.getTime() - 30 * 60 * 1000),
          finishedAt,
          status: SessionStatus.completed,
          startCommandId: randomUUID(),
          completeCommandId: randomUUID(),
        },
      });
      await prisma.inspection.create({
        data: {
          taskId: task.id,
          inspectorEmployeeId: createdEmployees.S002,
          inspectedAt: new Date(finishedAt.getTime() + 15 * 60 * 1000),
          result: InspectionResult.rejected,
          findings: "Repeat fail — under bed debris",
          commandId: randomUUID(),
        },
      });
      rejectedInspections += 1;
    }
  }
  console.log(`Rejected inspections seeded: ${rejectedInspections}`);

  // --- Sectors & shifts (S06) ---
  const roomOnly = locations.filter((l) => l.kind === LocationKind.room);
  const mainRooms = roomOnly.filter(
    (l) => !l.number.startsWith("A") && !l.number.startsWith("R"),
  );
  const annexRooms = roomOnly.filter((l) => l.number.startsWith("A"));
  const floors1_2 = mainRooms.filter(
    (l) => l.number.startsWith("1") || l.number.startsWith("2"),
  );
  const floors3_4 = mainRooms.filter(
    (l) => l.number.startsWith("3") || l.number.startsWith("4"),
  );

  const sectorA = await prisma.sector.create({
    data: {
      propertyId: property.id,
      code: "A",
      nameBg: "Сектор А — MAIN 1-2",
      nameEn: "Sector A — MAIN 1-2",
      primarySupervisorEmployeeId: createdEmployees.S001,
      locations: {
        create: floors1_2.map((l) => ({ locationId: l.id })),
      },
    },
  });
  const sectorB = await prisma.sector.create({
    data: {
      propertyId: property.id,
      code: "B",
      nameBg: "Сектор Б — MAIN 3-4",
      nameEn: "Sector B — MAIN 3-4",
      primarySupervisorEmployeeId: createdEmployees.S002,
      locations: {
        create: floors3_4.map((l) => ({ locationId: l.id })),
      },
    },
  });
  const sectorC = await prisma.sector.create({
    data: {
      propertyId: property.id,
      code: "C",
      nameBg: "Сектор В — Annex",
      nameEn: "Sector C — Annex",
      primarySupervisorEmployeeId: createdEmployees.S001,
      locations: {
        create: annexRooms.map((l) => ({ locationId: l.id })),
      },
    },
  });

  const royalFloorOf = (number: string): number | null => {
    if (!number.startsWith("R")) return null;
    const rest = number.slice(1);
    if (rest.length === 4 && rest.startsWith("10")) return 10;
    if (rest.length === 3) return Number(rest[0]);
    return null;
  };
  const royalRooms = roomOnly.filter((l) => l.number.startsWith("R"));
  const royalD = royalRooms.filter((l) => {
    const f = royalFloorOf(l.number);
    return f !== null && f >= 1 && f <= 3;
  });
  const royalE = royalRooms.filter((l) => {
    const f = royalFloorOf(l.number);
    return f !== null && f >= 4 && f <= 6;
  });
  const royalF = royalRooms.filter((l) => {
    const f = royalFloorOf(l.number);
    return f !== null && f >= 7 && f <= 10;
  });

  const lobbyLoc = commonAreas.find((l) => l.number === "Lobby");
  const poolLoc = commonAreas.find((l) => l.number === "Pool");
  const spaLoc = commonAreas.find((l) => l.number === "Spa");

  const sectorD = await prisma.sector.create({
    data: {
      propertyId: property.id,
      code: "D",
      nameBg: "Сектор Г — Royal 1-3",
      nameEn: "Sector D — Royal 1-3",
      primarySupervisorEmployeeId: createdEmployees.S002,
      locations: {
        create: [
          ...royalD.map((l) => ({ locationId: l.id })),
          ...(lobbyLoc ? [{ locationId: lobbyLoc.id }] : []),
        ],
      },
    },
  });
  const sectorE = await prisma.sector.create({
    data: {
      propertyId: property.id,
      code: "E",
      nameBg: "Сектор Д — Royal 4-6",
      nameEn: "Sector E — Royal 4-6",
      primarySupervisorEmployeeId: createdEmployees.S001,
      locations: {
        create: [
          ...royalE.map((l) => ({ locationId: l.id })),
          ...(spaLoc ? [{ locationId: spaLoc.id }] : []),
        ],
      },
    },
  });
  const sectorF = await prisma.sector.create({
    data: {
      propertyId: property.id,
      code: "F",
      nameBg: "Сектор Е — Royal 7-10",
      nameEn: "Sector F — Royal 7-10",
      primarySupervisorEmployeeId: createdEmployees.S002,
      locations: {
        create: [
          ...royalF.map((l) => ({ locationId: l.id })),
          ...(poolLoc ? [{ locationId: poolLoc.id }] : []),
        ],
      },
    },
  });

  await prisma.shift.createMany({
    data: [
      {
        code: "MORNING",
        nameBg: "Сутрешна",
        nameEn: "Morning",
        startTime: "06:00",
        endTime: "14:00",
        sortOrder: 1,
      },
      {
        code: "AFTERNOON",
        nameBg: "Следобедна",
        nameEn: "Afternoon",
        startTime: "14:00",
        endTime: "22:00",
        sortOrder: 2,
      },
      {
        code: "NIGHT",
        nameBg: "Нощна",
        nameEn: "Night",
        startTime: "22:00",
        endTime: "06:00",
        sortOrder: 3,
      },
    ],
  });
  const seededShifts = await prisma.shift.findMany({
    orderBy: { sortOrder: "asc" },
  });
  const morningShift = seededShifts.find((s) => s.code === "MORNING")!;
  const afternoonShift = seededShifts.find((s) => s.code === "AFTERNOON")!;

  const rosterDay = new Date();
  rosterDay.setUTCHours(0, 0, 0, 0);
  const morningHk = ["H001", "H002", "H003", "H004", "H005", "H006"];
  const afternoonHk = ["H007", "H008", "H009", "H010", "H011", "H012"];
  await prisma.employeeShiftRoster.createMany({
    data: [
      ...morningHk
        .filter((n) => createdEmployees[n])
        .map((n) => ({
          employeeId: createdEmployees[n],
          hotelDate: rosterDay,
          shiftId: morningShift.id,
        })),
      ...afternoonHk
        .filter((n) => createdEmployees[n])
        .map((n) => ({
          employeeId: createdEmployees[n],
          hotelDate: rosterDay,
          shiftId: afternoonShift.id,
        })),
    ],
  });

  // Stamp a portion of today's active cleaning tasks with a shift
  const activeToday = await prisma.cleaningTask.findMany({
    where: {
      hotelDate: rosterDay,
      status: { in: ["assigned", "in_progress", "awaiting_inspection", "rework"] },
    },
    select: { id: true, assignedEmployeeId: true },
    take: 40,
  });
  for (let i = 0; i < activeToday.length; i++) {
    const task = activeToday[i]!;
    let shiftId = i % 2 === 0 ? morningShift.id : afternoonShift.id;
    if (task.assignedEmployeeId) {
      const roster = await prisma.employeeShiftRoster.findUnique({
        where: {
          employeeId_hotelDate: {
            employeeId: task.assignedEmployeeId,
            hotelDate: rosterDay,
          },
        },
      });
      if (roster) shiftId = roster.shiftId;
    }
    await prisma.cleaningTask.update({
      where: { id: task.id },
      data: { shiftId },
    });
  }

  const sectorLocCount = await prisma.sectorLocation.count();
  const rosterCount = await prisma.employeeShiftRoster.count();
  console.log(
    `Sectors seeded: ${sectorA.code}/${sectorB.code}/${sectorC.code}/${sectorD.code}/${sectorE.code}/${sectorF.code}; ${sectorLocCount} locations; 3 shifts; ${rosterCount} roster rows; ${activeToday.length} tasks with shiftId`,
  );

  // --- Daily plan Clock (S12) ---
  {
    const planDay = new Date();
    planDay.setUTCHours(0, 0, 0, 0);
    const receptionId = createdEmployees.R001;
    const departureRoom =
      locations.find(
        (l) =>
          l.kind === LocationKind.room &&
          l.number === "102" &&
          !l.number.startsWith("A"),
      ) ??
      locations.find(
        (l) => l.kind === LocationKind.room && l.number === "201",
      );
    const arrivalRoom = locations.find(
      (l) => l.kind === LocationKind.room && l.number === "301",
    );
    const priorityRoom = locations.find(
      (l) => l.kind === LocationKind.room && l.number === "105",
    );

    if (receptionId && departureRoom) {
      const depTask = await prisma.cleaningTask.findFirst({
        where: {
          locationId: departureRoom.id,
          hotelDate: planDay,
          status: { in: [TaskStatus.assigned, TaskStatus.in_progress, TaskStatus.awaiting_inspection] },
        },
      });
      await prisma.location.update({
        where: { id: departureRoom.id },
        data: {
          occupancy: Occupancy.vacant,
          cleaningStatus: CleaningStatus.dirty,
        },
      });
      let cleaningTaskId = depTask?.id ?? null;
      if (!cleaningTaskId) {
        const created = await prisma.cleaningTask.create({
          data: {
            locationId: departureRoom.id,
            hotelDate: planDay,
            priority: Priority.high,
            assignedEmployeeId: createdEmployees.H001,
            status: TaskStatus.assigned,
          },
        });
        cleaningTaskId = created.id;
      }
      await prisma.dailyPlanEntry.create({
        data: {
          hotelDate: planDay,
          locationId: departureRoom.id,
          category: "departure",
          notes: "Check-out 11:00",
          cleaningTaskId,
          roomEffectsAppliedAt: new Date(),
          createdByEmployeeId: receptionId,
        },
      });
    }

    if (receptionId && arrivalRoom) {
      let cleaningTaskId: string | null = null;
      if (arrivalRoom.cleaningStatus !== CleaningStatus.verified_clean) {
        const existing = await prisma.cleaningTask.findFirst({
          where: {
            locationId: arrivalRoom.id,
            hotelDate: planDay,
            status: {
              in: [
                TaskStatus.assigned,
                TaskStatus.in_progress,
                TaskStatus.awaiting_inspection,
              ],
            },
          },
        });
        if (existing) {
          cleaningTaskId = existing.id;
        } else {
          const created = await prisma.cleaningTask.create({
            data: {
              locationId: arrivalRoom.id,
              hotelDate: planDay,
              priority: Priority.high,
              assignedEmployeeId: createdEmployees.H002,
              status: TaskStatus.assigned,
            },
          });
          cleaningTaskId = created.id;
        }
      }
      await prisma.dailyPlanEntry.create({
        data: {
          hotelDate: planDay,
          locationId: arrivalRoom.id,
          category: "arrival",
          notes: "ETA 15:00",
          cleaningTaskId,
          createdByEmployeeId: receptionId,
        },
      });
    }

    if (receptionId && priorityRoom) {
      const existing = await prisma.cleaningTask.findFirst({
        where: {
          locationId: priorityRoom.id,
          hotelDate: planDay,
          status: {
            in: [
              TaskStatus.assigned,
              TaskStatus.in_progress,
              TaskStatus.awaiting_inspection,
            ],
          },
        },
      });
      let cleaningTaskId = existing?.id ?? null;
      if (existing) {
        await prisma.cleaningTask.update({
          where: { id: existing.id },
          data: { priority: Priority.urgent },
        });
      } else {
        if (
          priorityRoom.cleaningStatus === CleaningStatus.verified_clean ||
          priorityRoom.cleaningStatus === CleaningStatus.pending_inspection
        ) {
          await prisma.location.update({
            where: { id: priorityRoom.id },
            data: { cleaningStatus: CleaningStatus.dirty },
          });
        }
        const created = await prisma.cleaningTask.create({
          data: {
            locationId: priorityRoom.id,
            hotelDate: planDay,
            priority: Priority.urgent,
            assignedEmployeeId: createdEmployees.H003,
            status: TaskStatus.assigned,
          },
        });
        cleaningTaskId = created.id;
      }
      await prisma.dailyPlanEntry.create({
        data: {
          hotelDate: planDay,
          locationId: priorityRoom.id,
          category: "priority",
          notes: "VIP arrival",
          cleaningTaskId,
          createdByEmployeeId: receptionId,
        },
      });
    }

    // Sample JSON-import entries (source=import) for UI badge demo.
    // Use 206 — 203 already has an active live-board task for today.
    const importRoom = locations.find(
      (l) => l.kind === LocationKind.room && l.number === "206",
    );
    const importArrival = locations.find(
      (l) => l.kind === LocationKind.room && l.number === "204",
    );
    if (receptionId && (importRoom || importArrival)) {
      const hotelDateStr = planDay.toISOString().slice(0, 10);
      const batch = await prisma.dailyPlanImportBatch.create({
        data: {
          hotelDate: planDay,
          sourceLabel: "clock",
          status: "completed",
          totalCount: [importRoom, importArrival].filter(Boolean).length,
          createdCount: [importRoom, importArrival].filter(Boolean).length,
          skippedCount: 0,
          errorCount: 0,
          errors: [],
          createdByEmployeeId: receptionId,
        },
      });

      if (importRoom) {
        await prisma.location.update({
          where: { id: importRoom.id },
          data: {
            occupancy: Occupancy.vacant,
            cleaningStatus: CleaningStatus.dirty,
          },
        });
        const existingImportTask = await prisma.cleaningTask.findFirst({
          where: {
            locationId: importRoom.id,
            hotelDate: planDay,
            status: {
              in: [
                TaskStatus.assigned,
                TaskStatus.in_progress,
                TaskStatus.awaiting_inspection,
                TaskStatus.rework,
              ],
            },
          },
        });
        const task =
          existingImportTask ??
          (await prisma.cleaningTask.create({
            data: {
              locationId: importRoom.id,
              hotelDate: planDay,
              priority: Priority.high,
              status: TaskStatus.assigned,
            },
          }));
        await prisma.dailyPlanEntry.create({
          data: {
            hotelDate: planDay,
            locationId: importRoom.id,
            category: "departure",
            notes: "Imported departure 12:00",
            source: "import",
            externalId: `clock:dep:MAIN:206:${hotelDateStr}`,
            importBatchId: batch.id,
            cleaningTaskId: task.id,
            roomEffectsAppliedAt: new Date(),
            createdByEmployeeId: receptionId,
          },
        });
      }

      if (importArrival) {
        await prisma.dailyPlanEntry.create({
          data: {
            hotelDate: planDay,
            locationId: importArrival.id,
            category: "arrival",
            notes: "Imported ETA 16:00",
            source: "import",
            externalId: `clock:arr:MAIN:204:${hotelDateStr}`,
            importBatchId: batch.id,
            createdByEmployeeId: receptionId,
          },
        });
      }
    }

    const planCount = await prisma.dailyPlanEntry.count({
      where: { hotelDate: planDay },
    });
    console.log(`Daily plan seeded: ${planCount} entries for today`);

    // Multi-day density: yesterday + tomorrow + extra today rooms
    const dayOffsets = [-1, 0, 1] as const;
    const planRoomPools = [
      ["106", "108", "111", "202", "205", "209"],
      ["302", "303", "307", "309", "402", "403"],
      ["A102", "A201", "A202", "A203", "A204", "A205"],
      ["R105", "R210", "R315", "R425", "R530", "R710"],
    ];
    const categories = ["departure", "arrival", "priority"] as const;
    let multiDayEntries = 0;

    for (const offset of dayOffsets) {
      const day = new Date(planDay);
      day.setUTCDate(day.getUTCDate() + offset);
      const dayStr = day.toISOString().slice(0, 10);

      for (let p = 0; p < planRoomPools.length; p++) {
        for (let i = 0; i < planRoomPools[p].length; i++) {
          const roomNumber = planRoomPools[p][i];
          const loc = locations.find(
            (l) => l.kind === LocationKind.room && l.number === roomNumber,
          );
          if (!loc || !receptionId) continue;
          const category = categories[(i + p + Math.abs(offset)) % 3];
          try {
            let cleaningTaskId: string | null = null;
            const applyRoomEffects = offset <= 0 && category === "departure";
            if (offset === 0 && category === "departure") {
              const existing = await prisma.cleaningTask.findFirst({
                where: {
                  locationId: loc.id,
                  hotelDate: day,
                  status: {
                    in: [
                      TaskStatus.assigned,
                      TaskStatus.in_progress,
                      TaskStatus.awaiting_inspection,
                      TaskStatus.rework,
                    ],
                  },
                },
              });
              if (existing) {
                cleaningTaskId = existing.id;
              } else {
                const task = await prisma.cleaningTask.create({
                  data: {
                    locationId: loc.id,
                    hotelDate: day,
                    priority: Priority.high,
                    assignedEmployeeId: createdEmployees.H001,
                    status: TaskStatus.assigned,
                  },
                });
                cleaningTaskId = task.id;
              }
            }
            if (applyRoomEffects) {
              await prisma.location.update({
                where: { id: loc.id },
                data: {
                  occupancy: Occupancy.vacant,
                  cleaningStatus: CleaningStatus.dirty,
                },
              });
            }
            await prisma.dailyPlanEntry.create({
              data: {
                hotelDate: day,
                locationId: loc.id,
                category,
                notes: `${category} seed ${dayStr}`,
                source: "manual",
                cleaningTaskId,
                roomEffectsAppliedAt: applyRoomEffects ? new Date() : null,
                createdByEmployeeId: receptionId,
              },
            });
            multiDayEntries += 1;
          } catch {
            // unique (hotelDate, locationId, category) — skip collisions with earlier demos
          }
        }
      }

      if (offset === -1 && receptionId) {
        await prisma.dailyPlanImportBatch.create({
          data: {
            hotelDate: day,
            sourceLabel: "clock",
            status: "partial",
            totalCount: 6,
            createdCount: 4,
            skippedCount: 1,
            errorCount: 1,
            errors: [
              {
                line: 5,
                room: "R999",
                message: "Unknown room number",
              },
            ],
            createdByEmployeeId: receptionId,
          },
        });
      }
      if (offset === 1 && receptionId) {
        await prisma.dailyPlanImportBatch.create({
          data: {
            hotelDate: day,
            sourceLabel: "pms-export",
            status: "failed",
            totalCount: 10,
            createdCount: 0,
            skippedCount: 0,
            errorCount: 10,
            errors: [
              { message: "Upstream PMS timeout after 30s" },
              { message: "No rows committed" },
            ],
            createdByEmployeeId: receptionId,
          },
        });

        // One successful tomorrow import with a few entries
        const tomorrowBatch = await prisma.dailyPlanImportBatch.create({
          data: {
            hotelDate: day,
            sourceLabel: "clock-retry",
            status: "completed",
            totalCount: 3,
            createdCount: 3,
            skippedCount: 0,
            errorCount: 0,
            errors: [],
            createdByEmployeeId: receptionId,
          },
        });
        const tomorrowRooms = ["R111", "R222", "A105"];
        for (let ti = 0; ti < tomorrowRooms.length; ti++) {
          const loc = locations.find((l) => l.number === tomorrowRooms[ti]);
          if (!loc) continue;
          try {
            await prisma.dailyPlanEntry.create({
              data: {
                hotelDate: day,
                locationId: loc.id,
                category: categories[ti % 3],
                notes: `Imported ${dayStr}`,
                source: "import",
                externalId: `clock:${categories[ti % 3]}:${tomorrowRooms[ti]}:${dayStr}`,
                importBatchId: tomorrowBatch.id,
                createdByEmployeeId: receptionId,
              },
            });
            multiDayEntries += 1;
          } catch {
            /* unique collision */
          }
        }
      }
    }
    const totalPlan = await prisma.dailyPlanEntry.count();
    const batchCount = await prisma.dailyPlanImportBatch.count();
    console.log(
      `Daily plan multi-day: +${multiDayEntries} entries; total ${totalPlan}; batches ${batchCount}`,
    );
  }

  console.log(
    `Seed complete: ${locations.length - commonAreas.length} rooms, ${commonAreas.length} common areas, ${employees.length} activated users, ${pendingOnlyEmployees.length + 1} not-onboarded, ${ticketDefs.length} tickets, ${historySessions} history sessions. Password: demo1234. Demo invite code: DEMO-ONBOARD`,
  );

  const { DEFAULT_SETTINGS, SETTING_KEYS } = await import(
    "../src/services/settingsSchema"
  );
  for (const key of SETTING_KEYS) {
    await prisma.appSetting.create({
      data: {
        key,
        value: DEFAULT_SETTINGS[key],
        updatedByEmployeeId: createdEmployees.O001,
      },
    });
  }
  console.log(`Settings seeded: ${SETTING_KEYS.length} sections`);

  const { ensureDefaultRoleGrants } = await import(
    "../src/services/roleGrants"
  );
  await ensureDefaultRoleGrants();
  console.log("Role grants seeded from defaults");

  // --- Attendance demo (S13 / §6.5) ---
  const { ingestEvent, requestAdjustment } = await import(
    "../src/services/attendance"
  );
  const { AttendanceEventKind } = await import("@prisma/client");

  const hkId = createdEmployees.H001;
  const hk2Id = createdEmployees.H002;
  const techId = createdEmployees.T001;
  const today = new Date();
  const y = today.getUTCFullYear();
  const m = String(today.getUTCMonth() + 1).padStart(2, "0");
  const d = String(today.getUTCDate()).padStart(2, "0");
  const todayYmd = `${y}-${m}-${d}`;

  // Normal same-day closed interval (HK001)
  await ingestEvent({
    externalEventId: `sim-h001-in-${todayYmd}`,
    employeeId: hkId,
    kind: AttendanceEventKind.clock_in,
    deviceTime: `${todayYmd}T06:00:00.000Z`,
    receivedAt: `${todayYmd}T06:00:02.000Z`,
    clockSkewSeconds: -2,
  });
  await ingestEvent({
    externalEventId: `sim-h001-bs-${todayYmd}`,
    employeeId: hkId,
    kind: AttendanceEventKind.break_start,
    deviceTime: `${todayYmd}T10:00:00.000Z`,
    receivedAt: `${todayYmd}T10:00:01.000Z`,
    clockSkewSeconds: 0,
  });
  await ingestEvent({
    externalEventId: `sim-h001-be-${todayYmd}`,
    employeeId: hkId,
    kind: AttendanceEventKind.break_end,
    deviceTime: `${todayYmd}T10:30:00.000Z`,
    receivedAt: `${todayYmd}T10:30:01.000Z`,
    clockSkewSeconds: 0,
  });
  await ingestEvent({
    externalEventId: `sim-h001-out-${todayYmd}`,
    employeeId: hkId,
    kind: AttendanceEventKind.clock_out,
    deviceTime: `${todayYmd}T14:00:00.000Z`,
    receivedAt: `${todayYmd}T14:00:01.000Z`,
    clockSkewSeconds: 0,
  });

  // Duplicate ingest — must be no-op
  const dup = await ingestEvent({
    externalEventId: `sim-h001-out-${todayYmd}`,
    employeeId: hkId,
    kind: AttendanceEventKind.clock_out,
    deviceTime: `${todayYmd}T14:00:00.000Z`,
    receivedAt: `${todayYmd}T14:00:01.000Z`,
    clockSkewSeconds: 0,
  });
  if (dup.created) {
    throw new Error("Expected duplicate attendance ingest to be idempotent");
  }

  // Overnight 20:00–08:00 with breaks (HK002) — hotelDate = start day
  const yesterday = new Date(Date.UTC(y, today.getUTCMonth(), today.getUTCDate() - 1));
  const yY = yesterday.getUTCFullYear();
  const yM = String(yesterday.getUTCMonth() + 1).padStart(2, "0");
  const yD = String(yesterday.getUTCDate()).padStart(2, "0");
  const yestYmd = `${yY}-${yM}-${yD}`;
  await ingestEvent({
    externalEventId: `sim-h002-in-night-${yestYmd}`,
    employeeId: hk2Id,
    kind: AttendanceEventKind.clock_in,
    deviceTime: `${yestYmd}T17:00:00.000Z`, // 20:00 Sofia (UTC+3)
    receivedAt: `${yestYmd}T17:00:01.000Z`,
    clockSkewSeconds: 0,
  });
  await ingestEvent({
    externalEventId: `sim-h002-bs-night-${yestYmd}`,
    employeeId: hk2Id,
    kind: AttendanceEventKind.break_start,
    deviceTime: `${yestYmd}T23:00:00.000Z`,
    receivedAt: `${yestYmd}T23:00:01.000Z`,
    clockSkewSeconds: 0,
  });
  await ingestEvent({
    externalEventId: `sim-h002-be-night-${yestYmd}`,
    employeeId: hk2Id,
    kind: AttendanceEventKind.break_end,
    deviceTime: `${todayYmd}T00:00:00.000Z`,
    receivedAt: `${todayYmd}T00:00:01.000Z`,
    clockSkewSeconds: 0,
  });
  await ingestEvent({
    externalEventId: `sim-h002-out-night-${yestYmd}`,
    employeeId: hk2Id,
    kind: AttendanceEventKind.clock_out,
    deviceTime: `${todayYmd}T05:00:00.000Z`, // 08:00 Sofia
    receivedAt: `${todayYmd}T05:00:01.000Z`,
    clockSkewSeconds: 0,
  });

  // Open / missing end → needs_review (tech), started >14h ago + large skew (S13)
  const staleStart = new Date(Date.now() - 16 * 3600_000);
  await ingestEvent({
    externalEventId: `sim-t001-open-${staleStart.toISOString()}`,
    employeeId: techId,
    kind: AttendanceEventKind.clock_in,
    deviceTime: staleStart.toISOString(),
    receivedAt: new Date(staleStart.getTime() + 3599 * 1000).toISOString(),
    clockSkewSeconds: 3599,
  });
  // Force missing_end flag via second touch: re-ingest won't open; update open interval
  const openInterval = await prisma.attendanceInterval.findFirst({
    where: { employeeId: techId, endedAt: null },
    orderBy: { startedAt: "desc" },
  });
  if (openInterval) {
    await prisma.attendanceInterval.update({
      where: { id: openInterval.id },
      data: {
        status: "needs_review",
        anomalyFlags: ["missing_end", "large_clock_skew"],
      },
    });

    // Pending adjustment on the review interval
    await requestAdjustment({
      intervalId: openInterval.id,
      requestedById: techId,
      actorRole: Role.technician,
      reason: "Forgot to clock out at end of shift",
      proposedEndedAt: new Date(
        openInterval.startedAt.getTime() + 8 * 3600_000,
      ).toISOString(),
      proposedBreakMinutes: 30,
    });
  }

  const attendanceCount = await prisma.attendanceInterval.count();
  console.log(`Attendance seeded: ${attendanceCount} intervals`);

  // Dense multi-day attendance for month/week views (S13)
  const attendanceStaff: Array<{ emp: string; role: Role }> = [
    { emp: "H001", role: Role.housekeeper },
    { emp: "H002", role: Role.housekeeper },
    { emp: "H003", role: Role.housekeeper },
    { emp: "H004", role: Role.housekeeper },
    { emp: "H005", role: Role.housekeeper },
    { emp: "H006", role: Role.housekeeper },
    { emp: "S001", role: Role.supervisor },
    { emp: "S002", role: Role.supervisor },
    // T001 intentionally omitted — has open/needs_review demo above
    { emp: "T002", role: Role.technician },
    { emp: "T003", role: Role.technician },
  ];

  function ymdOffset(base: Date, daysBack: number): string {
    const d = new Date(
      Date.UTC(
        base.getUTCFullYear(),
        base.getUTCMonth(),
        base.getUTCDate() - daysBack,
      ),
    );
    const yy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    return `${yy}-${mm}-${dd}`;
  }

  let denseDays = 0;
  for (let dayBack = 2; dayBack <= 12; dayBack++) {
    const ymd = ymdOffset(today, dayBack);
    for (let si = 0; si < attendanceStaff.length; si++) {
      // Skip some combinations for realism
      if ((dayBack + si) % 7 === 0) continue;
      const staff = attendanceStaff[si];
      const employeeId = createdEmployees[staff.emp];
      if (!employeeId) continue;
      const inHour = 5 + (si % 3); // 05–07 UTC
      const outHour = inHour + 8;
      const breakHour = inHour + 3;
      try {
        await ingestEvent({
          externalEventId: `sim-${staff.emp.toLowerCase()}-in-${ymd}`,
          employeeId,
          kind: AttendanceEventKind.clock_in,
          deviceTime: `${ymd}T${String(inHour).padStart(2, "0")}:00:00.000Z`,
          receivedAt: `${ymd}T${String(inHour).padStart(2, "0")}:00:01.000Z`,
          clockSkewSeconds: (si % 5 === 0 ? 120 : 0),
        });
        if (si % 3 !== 2) {
          await ingestEvent({
            externalEventId: `sim-${staff.emp.toLowerCase()}-bs-${ymd}`,
            employeeId,
            kind: AttendanceEventKind.break_start,
            deviceTime: `${ymd}T${String(breakHour).padStart(2, "0")}:00:00.000Z`,
            receivedAt: `${ymd}T${String(breakHour).padStart(2, "0")}:00:01.000Z`,
            clockSkewSeconds: 0,
          });
          await ingestEvent({
            externalEventId: `sim-${staff.emp.toLowerCase()}-be-${ymd}`,
            employeeId,
            kind: AttendanceEventKind.break_end,
            deviceTime: `${ymd}T${String(breakHour).padStart(2, "0")}:30:00.000Z`,
            receivedAt: `${ymd}T${String(breakHour).padStart(2, "0")}:30:01.000Z`,
            clockSkewSeconds: 0,
          });
        }
        // Leave one open/missing_end every few days for T002
        if (staff.emp === "T002" && dayBack === 3) {
          denseDays += 1;
          continue;
        }
        await ingestEvent({
          externalEventId: `sim-${staff.emp.toLowerCase()}-out-${ymd}`,
          employeeId,
          kind: AttendanceEventKind.clock_out,
          deviceTime: `${ymd}T${String(outHour).padStart(2, "0")}:00:00.000Z`,
          receivedAt: `${ymd}T${String(outHour).padStart(2, "0")}:00:01.000Z`,
          clockSkewSeconds: 0,
        });
        denseDays += 1;
      } catch (err) {
        console.warn(
          `Attendance dense seed skip ${staff.emp} ${ymd}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  // Extra adjustments: approved + rejected on closed HK intervals
  const { reviewAdjustment } = await import("../src/services/attendance");
  const closedHkIntervals = await prisma.attendanceInterval.findMany({
    where: {
      employeeId: { in: [createdEmployees.H003, createdEmployees.H004].filter(Boolean) },
      endedAt: { not: null },
      status: { in: ["closed", "needs_review", "adjusted"] },
    },
    orderBy: { startedAt: "desc" },
    take: 4,
  });

  if (closedHkIntervals[0] && createdEmployees.H003) {
    const adj1 = await requestAdjustment({
      intervalId: closedHkIntervals[0].id,
      requestedById: createdEmployees.H003,
      actorRole: Role.housekeeper,
      reason: "Break was 45 minutes, not 30",
      proposedBreakMinutes: 45,
    });
    const pending1 = await prisma.attendanceAdjustment.findFirst({
      where: { intervalId: closedHkIntervals[0].id, status: "pending" },
      orderBy: { createdAt: "desc" },
    });
    if (pending1 && createdEmployees.S001) {
      await reviewAdjustment({
        adjustmentId: pending1.id,
        reviewedById: createdEmployees.S001,
        decision: "approved",
        reason: "Verified with supervisor log",
      });
    }
    void adj1;
  }
  if (closedHkIntervals[1] && createdEmployees.H004) {
    await requestAdjustment({
      intervalId: closedHkIntervals[1].id,
      requestedById: createdEmployees.H004,
      actorRole: Role.housekeeper,
      reason: "Forgot morning clock-in — arrived at 07:00",
      proposedStartedAt: new Date(
        closedHkIntervals[1].startedAt.getTime() - 30 * 60 * 1000,
      ).toISOString(),
    });
    const pending2 = await prisma.attendanceAdjustment.findFirst({
      where: { intervalId: closedHkIntervals[1].id, status: "pending" },
      orderBy: { createdAt: "desc" },
    });
    if (pending2 && createdEmployees.S002) {
      await reviewAdjustment({
        adjustmentId: pending2.id,
        reviewedById: createdEmployees.S002,
        decision: "rejected",
        reason: "No badge evidence for earlier arrival",
      });
    }
  }

  const attendanceFinal = await prisma.attendanceInterval.count();
  const adjCount = await prisma.attendanceAdjustment.count();
  console.log(
    `Attendance dense: ~${denseDays} day-staff rows; intervals=${attendanceFinal}; adjustments=${adjCount}`,
  );

  // --- Access cards demo (S11 / §6.6) ---
  const { CardType, CardStatus } = await import("@prisma/client");
  const receptionId = createdEmployees.R001;
  const guestRoom =
    locations.find((l) => l.kind === LocationKind.room && l.number === "101") ??
    locations.find((l) => l.kind === LocationKind.room);
  const guestRoom2 = locations.find(
    (l) => l.kind === LocationKind.room && l.number === "R110",
  );
  if (guestRoom && receptionId) {
    await prisma.accessCard.create({
      data: {
        cardType: CardType.guest,
        status: CardStatus.active,
        label: "Demo guest 101",
        issuedByEmployeeId: receptionId,
        commandId: randomUUID(),
        grants: {
          create: {
            locationId: guestRoom.id,
            validFrom: new Date(),
            validUntil: new Date(Date.now() + 2 * 24 * 3600_000),
            issuedByEmployeeId: receptionId,
          },
        },
      },
    });
  }
  if (guestRoom2 && receptionId) {
    await prisma.accessCard.create({
      data: {
        cardType: CardType.guest,
        status: CardStatus.revoked,
        label: "Expired guest R110",
        issuedByEmployeeId: receptionId,
        commandId: randomUUID(),
        grants: {
          create: {
            locationId: guestRoom2.id,
            validFrom: new Date(Date.now() - 5 * 24 * 3600_000),
            validUntil: new Date(Date.now() - 1 * 24 * 3600_000),
            issuedByEmployeeId: receptionId,
          },
        },
      },
    });
  }
  if (hkId && receptionId) {
    await prisma.accessCard.create({
      data: {
        cardType: CardType.housekeeper,
        status: CardStatus.active,
        label: "Demo HK card",
        employeeId: hkId,
        issuedByEmployeeId: receptionId,
        commandId: randomUUID(),
        grants: {
          create: {
            validFrom: new Date(),
            validUntil: new Date(Date.now() + 30 * 24 * 3600_000),
            issuedByEmployeeId: receptionId,
          },
        },
      },
    });
  }
  if (techId && receptionId) {
    const spaId = locations.find((l) => l.number === "Spa")?.id;
    const poolId = locations.find((l) => l.number === "Pool")?.id;
    const techGrants = [
      spaId
        ? {
            locationId: spaId,
            validFrom: new Date(),
            validUntil: new Date(Date.now() + 14 * 24 * 3600_000),
            issuedByEmployeeId: receptionId,
          }
        : null,
      poolId
        ? {
            locationId: poolId,
            validFrom: new Date(),
            validUntil: new Date(Date.now() + 14 * 24 * 3600_000),
            issuedByEmployeeId: receptionId,
          }
        : null,
    ].filter((g): g is NonNullable<typeof g> => g !== null);
    await prisma.accessCard.create({
      data: {
        cardType: CardType.maintenance,
        status: CardStatus.active,
        label: "Tech floor access",
        employeeId: techId,
        issuedByEmployeeId: receptionId,
        commandId: randomUUID(),
        grants: techGrants.length ? { create: techGrants } : undefined,
      },
    });
  }
  if (createdEmployees.M001 && receptionId) {
    await prisma.accessCard.create({
      data: {
        cardType: CardType.manager,
        status: CardStatus.active,
        label: "Manager all-areas",
        employeeId: createdEmployees.M001,
        issuedByEmployeeId: receptionId,
        commandId: randomUUID(),
        grants: {
          create: {
            validFrom: new Date(Date.now() - 7 * 24 * 3600_000),
            validUntil: new Date(Date.now() + 90 * 24 * 3600_000),
            issuedByEmployeeId: receptionId,
          },
        },
      },
    });
  }
  if (createdEmployees.O001 && receptionId) {
    await prisma.accessCard.create({
      data: {
        cardType: CardType.master,
        status: CardStatus.active,
        label: "Master key",
        employeeId: createdEmployees.O001,
        issuedByEmployeeId: receptionId,
        commandId: randomUUID(),
        grants: {
          create: {
            validFrom: new Date(Date.now() - 30 * 24 * 3600_000),
            validUntil: new Date(Date.now() + 365 * 24 * 3600_000),
            issuedByEmployeeId: receptionId,
          },
        },
      },
    });
  }
  if (createdEmployees.H007 && createdEmployees.M001) {
    await prisma.accessCard.create({
      data: {
        cardType: CardType.housekeeper,
        status: CardStatus.revoked,
        label: "Revoked HK H007",
        employeeId: createdEmployees.H007,
        issuedByEmployeeId: createdEmployees.M001,
        commandId: randomUUID(),
        grants: {
          create: {
            validFrom: new Date(Date.now() - 60 * 24 * 3600_000),
            validUntil: new Date(Date.now() + 30 * 24 * 3600_000),
            issuedByEmployeeId: createdEmployees.M001,
          },
        },
      },
    });
  }
  const cardCount = await prisma.accessCard.count();
  const grantCount = await prisma.accessGrant.count();
  console.log(`Access cards seeded: ${cardCount} cards, ${grantCount} grants`);

  // --- Devices + consumed invitation (S05) ---
  const deviceUsers = await prisma.user.findMany({
    where: {
      email: {
        in: [
          "housekeeper@meridian.local",
          "supervisor@meridian.local",
          "technician@meridian.local",
          "reception@meridian.local",
          "admin@meridian.local",
          "monika@meridian.local",
        ],
      },
    },
  });
  const createdDevices: Array<{ id: string; userId: string; employeeId: string }> =
    [];
  for (let i = 0; i < deviceUsers.length; i++) {
    const u = deviceUsers[i];
    const device = await prisma.device.create({
      data: {
        userId: u.id,
        employeeId: u.employeeId,
        label: `${u.email.split("@")[0]} phone`,
        fingerprint: `fp-seed-${u.email}-${i}`,
        activatedAt: new Date(Date.now() - (i + 1) * 24 * 3600_000),
        lastSeenAt: new Date(Date.now() - i * 3600_000),
        lastSyncedAt: new Date(Date.now() - i * 1800_000),
        revokedAt:
          u.email === "monika@meridian.local"
            ? new Date(Date.now() - 3 * 3600_000)
            : undefined,
      },
    });
    createdDevices.push({
      id: device.id,
      userId: u.id,
      employeeId: u.employeeId,
    });
  }

  // Consumed invitation linked to H013's device
  const monikaUser = deviceUsers.find((u) => u.email === "monika@meridian.local");
  const monikaDevice = createdDevices.find(
    (d) => d.employeeId === createdEmployees.H013,
  );
  if (ownerUser && monikaUser && monikaDevice) {
    const consumedCode = "DEMO-CONSUMED";
    await prisma.invitation.create({
      data: {
        codeHash: crypto
          .createHash("sha256")
          .update(consumedCode)
          .digest("hex"),
        codeHint: consumedCode.slice(-4),
        employeeId: createdEmployees.H013,
        role: Role.housekeeper,
        email: monikaUser.email,
        status: "consumed",
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        consumedAt: new Date(Date.now() - 10 * 24 * 3600_000),
        consumedDeviceId: monikaDevice.id,
        createdByUserId: ownerUser.id,
      },
    });
  }
  const inviteCount = await prisma.invitation.count();
  const deviceCount = await prisma.device.count();
  console.log(`Invitations: ${inviteCount}; Devices: ${deviceCount}`);

  // --- Unified audit samples (Settings / Permissions chronology + live feed) ---
  const sampleActorId = createdEmployees.A001 ?? createdEmployees.M001 ?? receptionId;
  const sampleLocationId =
    locations.find((l) => l.kind === LocationKind.room)?.id ?? null;
  const sampleTicket = await prisma.maintenanceTicket.findFirst({
    orderBy: { createdAt: "desc" },
  });

  if (sampleActorId) {
    await prisma.auditEvent.createMany({
      data: [
        {
          actorEmployeeId: sampleActorId,
          action: "setting.update",
          entityType: "setting",
          entityId: "operations",
          reason: "Seed demo",
          before: { overdueSessionMinutes: 240 },
          after: { overdueSessionMinutes: 240 },
          summary: "Updated setting operations",
          occurredAt: new Date(Date.now() - 5 * 24 * 3600_000),
        },
        {
          actorEmployeeId: sampleActorId,
          action: "permission.grant",
          entityType: "role_grant",
          entityId: "supervisor:action:operations.view_live",
          reason: "Seed demo",
          before: { granted: false },
          after: {
            role: "supervisor",
            kind: "action",
            key: "operations.view_live",
            granted: true,
          },
          summary: "Granted action operations.view_live for supervisor",
          occurredAt: new Date(Date.now() - 4 * 24 * 3600_000),
        },
        ...(sampleLocationId
          ? [
              {
                actorEmployeeId: sampleActorId,
                action: "location.mark_dirty",
                entityType: "location",
                entityId: sampleLocationId,
                locationId: sampleLocationId,
                before: { cleaningStatus: "verified_clean" },
                after: { cleaningStatus: "dirty" },
                summary: "Marked room dirty (seed)",
                occurredAt: new Date(Date.now() - 3 * 24 * 3600_000),
              },
              {
                actorEmployeeId: createdEmployees.S001,
                action: "location.mark_clean",
                entityType: "location",
                entityId: sampleLocationId,
                locationId: sampleLocationId,
                before: { cleaningStatus: "dirty" },
                after: { cleaningStatus: "verified_clean" },
                summary: "Verified clean after inspection",
                occurredAt: new Date(Date.now() - 2 * 24 * 3600_000),
              },
            ]
          : []),
        {
          actorEmployeeId: createdEmployees.R001,
          action: "card.issue",
          entityType: "access_card",
          entityId: "seed-guest-101",
          summary: "Issued guest card for room 101",
          after: { cardType: "guest", status: "active" },
          occurredAt: new Date(Date.now() - 36 * 3600_000),
        },
        {
          actorEmployeeId: createdEmployees.M001,
          action: "card.revoke",
          entityType: "access_card",
          entityId: "seed-hk-h007",
          reason: "Employee left shift early",
          summary: "Revoked housekeeper card",
          after: { status: "revoked" },
          occurredAt: new Date(Date.now() - 30 * 3600_000),
        },
        {
          actorEmployeeId: createdEmployees.S001,
          action: "sector.update",
          entityType: "sector",
          entityId: "D",
          summary: "Updated Royal sector D membership",
          after: { code: "D", rooms: 90 },
          occurredAt: new Date(Date.now() - 20 * 3600_000),
        },
        {
          actorEmployeeId: createdEmployees.T001,
          action: "ticket.assign",
          entityType: "maintenance_ticket",
          entityId: sampleTicket?.id ?? "seed-ticket",
          locationId: sampleTicket?.locationId,
          summary: "Assigned ticket to technician",
          after: { status: "assigned", assignee: "T001" },
          occurredAt: new Date(Date.now() - 12 * 3600_000),
        },
        {
          actorEmployeeId: createdEmployees.T002,
          action: "ticket.resolve",
          entityType: "maintenance_ticket",
          entityId: sampleTicket?.id ?? "seed-ticket",
          locationId: sampleTicket?.locationId,
          summary: "Resolved maintenance ticket",
          after: { status: "resolved" },
          occurredAt: new Date(Date.now() - 8 * 3600_000),
        },
        {
          actorEmployeeId: createdEmployees.S002,
          action: "task.rework",
          entityType: "cleaning_task",
          entityId: "seed-rework",
          locationId: sampleLocationId,
          reason: "Inspection rejected",
          summary: "Sent task back to rework",
          occurredAt: new Date(Date.now() - 6 * 3600_000),
        },
        {
          actorEmployeeId: createdEmployees.R002,
          action: "daily_plan.import",
          entityType: "daily_plan_import_batch",
          entityId: "seed-clock",
          summary: "Imported clock departures/arrivals",
          after: { status: "completed", createdCount: 2 },
          occurredAt: new Date(Date.now() - 5 * 3600_000),
        },
        {
          actorEmployeeId: createdEmployees.A001,
          action: "setting.update",
          entityType: "setting",
          entityId: "notifications",
          summary: "Updated notification preferences",
          before: { pushEnabled: true },
          after: { pushEnabled: true, emailDigest: "daily" },
          occurredAt: new Date(Date.now() - 4 * 3600_000),
        },
        {
          actorEmployeeId: createdEmployees.O001,
          action: "permission.revoke",
          entityType: "role_grant",
          entityId: "housekeeper:action:settings.edit",
          summary: "Revoked settings.edit from housekeeper",
          after: { granted: false },
          occurredAt: new Date(Date.now() - 3 * 3600_000),
        },
        {
          actorEmployeeId: createdEmployees.S001,
          action: "attendance.review",
          entityType: "attendance_adjustment",
          entityId: "seed-adj",
          summary: "Approved attendance adjustment",
          after: { decision: "approved" },
          occurredAt: new Date(Date.now() - 2 * 3600_000),
        },
        {
          actorEmployeeId: createdEmployees.H001,
          action: "session.start",
          entityType: "cleaning_session",
          entityId: "seed-session",
          locationId: sampleLocationId,
          summary: "Started cleaning session",
          occurredAt: new Date(Date.now() - 90 * 60_000),
        },
        {
          actorEmployeeId: createdEmployees.H001,
          action: "session.complete",
          entityType: "cleaning_session",
          entityId: "seed-session",
          locationId: sampleLocationId,
          summary: "Completed cleaning session",
          occurredAt: new Date(Date.now() - 60 * 60_000),
        },
        {
          actorEmployeeId: createdEmployees.A002,
          action: "device.revoke",
          entityType: "device",
          entityId: monikaDevice?.id ?? "seed-device",
          reason: "Lost device reported",
          summary: "Revoked device for H013",
          occurredAt: new Date(Date.now() - 3 * 3600_000),
        },
        {
          actorEmployeeId: createdEmployees.M002,
          action: "invitation.revoke",
          entityType: "invitation",
          entityId: "DEMO-REVOKED",
          summary: "Revoked onboarding invitation",
          occurredAt: new Date(Date.now() - 2 * 60 * 60_000),
        },
      ],
    });
  }
  const auditCount = await prisma.auditEvent.count();
  console.log(`Audit events seeded: ${auditCount}`);

  // --- JobRun + SyncRun demos ---
  await prisma.jobRun.createMany({
    data: [
      {
        jobKey: "daily_plan.import",
        startedAt: new Date(Date.now() - 6 * 3600_000),
        finishedAt: new Date(Date.now() - 6 * 3600_000 + 12_000),
        status: "succeeded",
        summary: { created: 2, skipped: 0, errors: 0 },
      },
      {
        jobKey: "attendance.normalize",
        startedAt: new Date(Date.now() - 5 * 3600_000),
        finishedAt: new Date(Date.now() - 5 * 3600_000 + 45_000),
        status: "succeeded",
        summary: { intervalsClosed: 18, flagged: 1 },
      },
      {
        jobKey: "daily_plan.import",
        startedAt: new Date(Date.now() - 4 * 3600_000),
        finishedAt: new Date(Date.now() - 4 * 3600_000 + 30_000),
        status: "failed",
        summary: { created: 0 },
        error: "Upstream PMS timeout after 30s",
      },
      {
        jobKey: "analytics.rebuild",
        startedAt: new Date(Date.now() - 2 * 3600_000),
        finishedAt: new Date(Date.now() - 2 * 3600_000 + 90_000),
        status: "succeeded",
        summary: { tickets: 40, sessions: 80 },
      },
      {
        jobKey: "sessions.anomaly_scan",
        startedAt: new Date(Date.now() - 1 * 3600_000),
        finishedAt: new Date(Date.now() - 1 * 3600_000 + 8_000),
        status: "succeeded",
        summary: { flagged: 3 },
      },
    ],
  });

  const syncUser =
    deviceUsers.find((u) => u.email === "housekeeper@meridian.local") ??
    deviceUsers[0];
  const syncDevice =
    createdDevices.find((d) => d.userId === syncUser?.id) ?? createdDevices[0];
  if (syncUser) {
    await prisma.syncRun.createMany({
      data: [
        {
          userId: syncUser.id,
          deviceId: syncDevice?.id,
          direction: "outbound",
          startedAt: new Date(Date.now() - 3 * 3600_000),
          finishedAt: new Date(Date.now() - 3 * 3600_000 + 5_000),
          status: "succeeded",
          accepted: 12,
          rejected: 0,
        },
        {
          userId: syncUser.id,
          deviceId: syncDevice?.id,
          direction: "inbound",
          startedAt: new Date(Date.now() - 2 * 3600_000),
          finishedAt: new Date(Date.now() - 2 * 3600_000 + 8_000),
          status: "succeeded",
          accepted: 9,
          rejected: 1,
          conflicts: [
            {
              entity: "cleaning_session",
              reason: "version mismatch",
            },
          ],
        },
        {
          userId: syncUser.id,
          deviceId: syncDevice?.id,
          direction: "outbound",
          startedAt: new Date(Date.now() - 1 * 3600_000),
          finishedAt: new Date(Date.now() - 1 * 3600_000 + 3_000),
          status: "failed",
          accepted: 0,
          rejected: 4,
          conflicts: [{ entity: "attendance_event", reason: "offline clock skew" }],
        },
        {
          userId:
            deviceUsers.find((u) => u.email === "supervisor@meridian.local")
              ?.id ?? syncUser.id,
          deviceId: createdDevices.find(
            (d) =>
              d.userId ===
              deviceUsers.find((u) => u.email === "supervisor@meridian.local")
                ?.id,
          )?.id,
          direction: "inbound",
          startedAt: new Date(Date.now() - 40 * 60_000),
          finishedAt: new Date(Date.now() - 40 * 60_000 + 4_000),
          status: "succeeded",
          accepted: 5,
          rejected: 0,
        },
      ],
    });
  }
  const jobCount = await prisma.jobRun.count();
  const syncCount = await prisma.syncRun.count();
  console.log(`Jobs seeded: ${jobCount}; Sync runs: ${syncCount}`);

  // Backfill CleaningTask.sectorId + sectorSupervisorEmployeeId from Sector membership
  const sectorSnapshots = await prisma.$executeRaw`
    UPDATE "CleaningTask" AS t
    SET
      "sectorId" = sl."sectorId",
      "sectorSupervisorEmployeeId" = COALESCE(
        t."sectorSupervisorEmployeeId",
        s."primarySupervisorEmployeeId"
      )
    FROM "SectorLocation" AS sl
    JOIN "Sector" AS s ON s."id" = sl."sectorId"
    WHERE sl."locationId" = t."locationId" AND t."sectorId" IS NULL
  `;
  console.log(`Task sector snapshots backfilled: ${sectorSnapshots}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
