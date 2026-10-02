import { PrismaClient, Role, CleaningStatus, Occupancy, ServiceStatus } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  await prisma.cleaningSession.deleteMany();
  await prisma.cleaningTask.deleteMany();
  await prisma.user.deleteMany();
  await prisma.employee.deleteMany();
  await prisma.location.deleteMany();
  await prisma.floor.deleteMany();
  await prisma.building.deleteMany();
  await prisma.property.deleteMany();

  const property = await prisma.property.create({
    data: { name: "Imperial Resort" },
  });

  const building = await prisma.building.create({
    data: {
      propertyId: property.id,
      name: "Main Building",
      code: "MAIN",
    },
  });

  const floor1 = await prisma.floor.create({
    data: { buildingId: building.id, number: 1, name: "Floor 1" },
  });
  const floor2 = await prisma.floor.create({
    data: { buildingId: building.id, number: 2, name: "Floor 2" },
  });

  const roomDefs: Array<{
    floorId: string;
    number: string;
    occupancy: Occupancy;
    cleaningStatus: CleaningStatus;
    serviceStatus: ServiceStatus;
  }> = [
    { floorId: floor1.id, number: "101", occupancy: Occupancy.vacant, cleaningStatus: CleaningStatus.dirty, serviceStatus: ServiceStatus.in_service },
    { floorId: floor1.id, number: "102", occupancy: Occupancy.vacant, cleaningStatus: CleaningStatus.verified_clean, serviceStatus: ServiceStatus.in_service },
    { floorId: floor1.id, number: "103", occupancy: Occupancy.occupied, cleaningStatus: CleaningStatus.dirty, serviceStatus: ServiceStatus.in_service },
    { floorId: floor1.id, number: "104", occupancy: Occupancy.vacant, cleaningStatus: CleaningStatus.dirty, serviceStatus: ServiceStatus.out_of_service },
    { floorId: floor1.id, number: "105", occupancy: Occupancy.unknown, cleaningStatus: CleaningStatus.verified_clean, serviceStatus: ServiceStatus.in_service },
    { floorId: floor2.id, number: "201", occupancy: Occupancy.vacant, cleaningStatus: CleaningStatus.dirty, serviceStatus: ServiceStatus.in_service },
    { floorId: floor2.id, number: "202", occupancy: Occupancy.vacant, cleaningStatus: CleaningStatus.in_progress, serviceStatus: ServiceStatus.in_service },
    { floorId: floor2.id, number: "203", occupancy: Occupancy.occupied, cleaningStatus: CleaningStatus.verified_clean, serviceStatus: ServiceStatus.in_service },
    { floorId: floor2.id, number: "204", occupancy: Occupancy.vacant, cleaningStatus: CleaningStatus.dirty, serviceStatus: ServiceStatus.in_service },
    { floorId: floor2.id, number: "205", occupancy: Occupancy.vacant, cleaningStatus: CleaningStatus.pending_inspection, serviceStatus: ServiceStatus.unknown },
  ];

  for (const room of roomDefs) {
    await prisma.location.create({ data: room });
  }

  const passwordHash = await bcrypt.hash("demo1234", 10);

  const employees = [
    { employeeNumber: "R001", fullName: "Anna Reception", department: "Front Desk", email: "reception@imperial.local", role: Role.reception },
    { employeeNumber: "H001", fullName: "Maria Housekeeper", department: "Housekeeping", email: "housekeeper@imperial.local", role: Role.housekeeper },
    { employeeNumber: "S001", fullName: "Ivan Supervisor", department: "Housekeeping", email: "supervisor@imperial.local", role: Role.supervisor },
  ];

  for (const emp of employees) {
    const employee = await prisma.employee.create({
      data: {
        employeeNumber: emp.employeeNumber,
        fullName: emp.fullName,
        department: emp.department,
      },
    });
    await prisma.user.create({
      data: {
        employeeId: employee.id,
        email: emp.email,
        passwordHash,
        role: emp.role,
      },
    });
  }

  console.log("Seed complete. Demo password for all users: demo1234");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
