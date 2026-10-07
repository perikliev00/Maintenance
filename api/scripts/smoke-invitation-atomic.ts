/**
 * Smoke checks for atomic invitation redeem (service-layer concurrency).
 * Requires DB + seeded owner. Does not need the HTTP API.
 */
import "dotenv/config";
import {
  InvitationStatus,
  PrismaClient,
  Role,
} from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes, randomUUID } from "crypto";
import { AppError } from "../src/errors";
import {
  generateInviteCode,
  hashInviteCode,
  redeemInvitation,
} from "../src/services/invitations";

const prisma = new PrismaClient();

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function errCode(err: unknown): string | null {
  if (err instanceof AppError) return err.code;
  return null;
}

async function main() {
  const owner = await prisma.user.findUnique({
    where: { email: "owner@meridian.local" },
  });
  assert(owner, "seed owner@meridian.local required");

  const suffix = randomUUID().slice(0, 8);
  const employeeNumber = `SMK-${suffix}`;
  const email = `smoke.invite.${suffix}@meridian.local`;
  const code = generateInviteCode();
  const codeHash = hashInviteCode(code);

  const employee = await prisma.employee.create({
    data: {
      fullName: `Smoke Invite ${suffix}`,
      employeeNumber,
      department: "Housekeeping",
    },
  });

  await prisma.user.create({
    data: {
      employeeId: employee.id,
      email,
      passwordHash: await bcrypt.hash(`pending-${randomBytes(8).toString("hex")}`, 10),
      role: Role.housekeeper,
      activatedAt: null,
      isActive: true,
    },
  });

  const invitation = await prisma.invitation.create({
    data: {
      codeHash,
      codeHint: code.slice(-4),
      employeeId: employee.id,
      role: Role.housekeeper,
      email,
      status: InvitationStatus.issued,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      createdByUserId: owner.id,
    },
  });

  const password = "smoke-pass-1234";
  const settled = await Promise.allSettled([
    redeemInvitation({
      code,
      password,
      deviceLabel: "Smoke Device A",
      fingerprint: `fp-a-${suffix}`,
    }),
    redeemInvitation({
      code,
      password,
      deviceLabel: "Smoke Device B",
      fingerprint: `fp-b-${suffix}`,
    }),
  ]);

  const oks = settled.filter((s) => s.status === "fulfilled");
  const fails = settled.filter((s) => s.status === "rejected");
  console.log(
    "concurrent_redeem",
    oks.length,
    fails.map((f) =>
      f.status === "rejected" ? errCode(f.reason) ?? String(f.reason) : "",
    ),
  );

  assert(oks.length === 1, `expected 1 successful redeem, got ${oks.length}`);
  assert(fails.length === 1, `expected 1 failed redeem, got ${fails.length}`);

  const loserCode =
    fails[0]!.status === "rejected" ? errCode(fails[0].reason) : null;
  assert(
    loserCode === "conflict" || loserCode === "invalid_code",
    `loser should be conflict or invalid_code, got ${loserCode}`,
  );

  const devices = await prisma.device.findMany({
    where: { employeeId: employee.id, revokedAt: null },
  });
  assert(devices.length === 1, `expected 1 device, got ${devices.length}`);

  const sessions = await prisma.authSession.findMany({
    where: { deviceId: devices[0]!.id, revokedAt: null },
  });
  assert(
    sessions.length === 1,
    `expected 1 auth session, got ${sessions.length}`,
  );

  const consumed = await prisma.invitation.findUniqueOrThrow({
    where: { id: invitation.id },
  });
  assert(
    consumed.status === InvitationStatus.consumed,
    `expected consumed, got ${consumed.status}`,
  );
  assert(
    consumed.consumedDeviceId === devices[0]!.id,
    "consumedDeviceId should match the single device",
  );

  const user = await prisma.user.findUniqueOrThrow({
    where: { email },
  });
  assert(user.activatedAt != null, "user should be activated");

  console.log("smoke-invitation-atomic: ok");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
