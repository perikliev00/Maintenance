import {
  PrismaClient,
  Role,
  CleaningStatus,
  Occupancy,
  ServiceStatus,
  TicketCategory,
  Priority,
  TaskStatus,
} from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

type EmpDef = {
  employeeNumber: string;
  fullName: string;
  department: string;
  email: string;
  role: Role;
};

function cycle<T>(arr: T[], i: number): T {
  return arr[i % arr.length];
}

async function main() {
  await prisma.inspection.deleteMany();
  await prisma.cleaningSession.deleteMany();
  await prisma.cleaningTask.deleteMany();
  await prisma.maintenanceTicket.deleteMany();
  await prisma.user.deleteMany();
  await prisma.employee.deleteMany();
  await prisma.location.deleteMany();
  await prisma.floor.deleteMany();
  await prisma.building.deleteMany();
  await prisma.property.deleteMany();

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

  // ROYAL: 10 floors × 30 rooms = +300 → ~350 total
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
      },
    });
  }

  const ticketDefs: Array<{
    number: string;
    title: string;
    category: TicketCategory;
    priority: Priority;
    blocksRoom: boolean;
    reporter: string;
  }> = [
    { number: "104", title: "AC leak under window", category: TicketCategory.climate, priority: Priority.high, blocksRoom: true, reporter: "R001" },
    { number: "102", title: "Loose bathroom tap", category: TicketCategory.plumbing, priority: Priority.low, blocksRoom: false, reporter: "H001" },
    { number: "208", title: "No power at desk sockets", category: TicketCategory.electrical, priority: Priority.urgent, blocksRoom: true, reporter: "R002" },
    { number: "305", title: "Broken wardrobe hinge", category: TicketCategory.furniture, priority: Priority.normal, blocksRoom: false, reporter: "H003" },
    { number: "401", title: "Strong mold smell in bath", category: TicketCategory.other, priority: Priority.high, blocksRoom: true, reporter: "S001" },
    { number: "A101", title: "Annex AC not cooling", category: TicketCategory.climate, priority: Priority.high, blocksRoom: true, reporter: "H005" },
    { number: "A205", title: "Flickering bathroom light", category: TicketCategory.electrical, priority: Priority.normal, blocksRoom: false, reporter: "T001" },
    { number: "109", title: "Clogged sink", category: TicketCategory.plumbing, priority: Priority.urgent, blocksRoom: true, reporter: "H002" },
    { number: "207", title: "Chair leg cracked", category: TicketCategory.furniture, priority: Priority.low, blocksRoom: false, reporter: "H007" },
    { number: "410", title: "Window seal damaged", category: TicketCategory.other, priority: Priority.normal, blocksRoom: false, reporter: "M001" },
    { number: "R101", title: "Royal suite balcony door stuck", category: TicketCategory.furniture, priority: Priority.high, blocksRoom: true, reporter: "O001" },
    { number: "R515", title: "Royal wing spa pump noise", category: TicketCategory.plumbing, priority: Priority.normal, blocksRoom: false, reporter: "M002" },
  ];

  for (const t of ticketDefs) {
    const loc = locations.find((l) => l.number === t.number);
    if (!loc) continue;
    await prisma.maintenanceTicket.create({
      data: {
        locationId: loc.id,
        title: t.title,
        category: t.category,
        priority: t.priority,
        blocksRoom: t.blocksRoom,
        reportedByEmployeeId: createdEmployees[t.reporter],
      },
    });
  }

  const dirtyVacant = locations.find(
    (l) =>
      l.number === "101" ||
      (l.cleaningStatus === CleaningStatus.dirty &&
        l.occupancy === Occupancy.vacant &&
        l.serviceStatus === ServiceStatus.in_service),
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

  const pending = locations.find(
    (l) => l.cleaningStatus === CleaningStatus.pending_inspection,
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

  console.log(
    `Seed complete: ${locations.length} rooms, ${employees.length} users, ${ticketDefs.length} tickets. Password: demo1234`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
