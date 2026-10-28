/**
 * Smoke checks: invitation redeem must not restore a stale privileged role.
 * Uses real issueInvitation + people-style role change + redeemInvitation.
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
import { revokeAllForUser } from "../src/services/authSessions";
import {
  generateInviteCode,
  hashInviteCode,
  issueInvitation,
  redeemInvitation,
} from "../src/services/invitations";
import { isPrivilegedRole } from "../src/permissions";

const prisma = new PrismaClient();

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function errCode(err: unknown): string | null {
  if (err instanceof AppError) return err.code;
  return null;
}

async function expectReject(
  label: string,
  fn: () => Promise<unknown>,
  expected: string | string[],
) {
  const allowed = Array.isArray(expected) ? expected : [expected];
  try {
    await fn();
    throw new Error(
      `${label}: expected reject ${allowed.join("|")}, but succeeded`,
    );
  } catch (err) {
    if (err instanceof Error && err.message.startsWith(`${label}:`)) throw err;
    const code = errCode(err);
    assert(
      code != null && allowed.includes(code),
      `${label}: expected ${allowed.join("|")}, got ${code ?? String(err)}`,
    );
  }
}

/** Same writes as PATCH /people/:id/role when the role actually changes. */
async function changeRoleLikePeople(userId: string, nextRole: Role) {
  const target = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (target.role === nextRole) return;
  await prisma.user.update({
    where: { id: userId },
    data: { role: nextRole },
  });
  await revokeAllForUser(userId);
}

async function main() {
  const owner = await prisma.user.findUnique({
    where: { email: "owner@meridian.local" },
  });
  assert(owner, "seed owner@meridian.local required");
  const actor = { userId: owner.id, role: owner.role };

  // --- 1) Admin invite → demote to housekeeper before activation → redeem ---
  {
    const suffix = randomUUID().slice(0, 8);
    const issued = await issueInvitation(
      actor,
      {
        kind: "new",
        fullName: `Smoke Role Demote ${suffix}`,
        employeeNumber: `SRD-${suffix}`,
        email: `smoke.role.demote.${suffix}@meridian.local`,
        role: Role.admin,
        department: "Housekeeping",
      },
    );

    const pending = await prisma.user.findUniqueOrThrow({
      where: { email: issued.invitation.email },
    });
    assert(pending.role === Role.admin, "pending user should start as admin");
    assert(pending.activatedAt == null, "pending user should be unactivated");
    assert(
      issued.invitation.role === Role.admin,
      "invitation should snapshot admin",
    );

    await changeRoleLikePeople(pending.id, Role.housekeeper);

    const afterDemote = await prisma.user.findUniqueOrThrow({
      where: { id: pending.id },
    });
    assert(
      afterDemote.role === Role.housekeeper,
      "people-style demote should set housekeeper",
    );

    const frozenInvite = await prisma.invitation.findUniqueOrThrow({
      where: { id: issued.invitation.id },
    });
    assert(
      frozenInvite.role === Role.admin,
      "invitation.role must remain the frozen admin snapshot",
    );

    const result = await redeemInvitation({
      code: issued.code,
      password: "smoke-pass-1234",
      deviceLabel: "Role Demote Device",
      fingerprint: `fp-demote-${suffix}`,
    });

    assert(
      result.user.role === Role.housekeeper,
      `redeem payload role should be housekeeper, got ${result.user.role}`,
    );
    assert(
      !isPrivilegedRole(result.user.role),
      "redeem must not restore privileged role",
    );
    assert(
      !result.user.actions.includes("people.invite"),
      "housekeeper must not receive people.invite",
    );
    assert(
      !result.user.actions.includes("permissions.manage"),
      "housekeeper must not receive permissions.manage",
    );

    const dbUser = await prisma.user.findUniqueOrThrow({
      where: { id: pending.id },
    });
    assert(
      dbUser.role === Role.housekeeper,
      `DB role should stay housekeeper, got ${dbUser.role}`,
    );
    assert(dbUser.activatedAt != null, "user should be activated");

    console.log("stale_privileged_invite_demote: ok");
  }

  // --- 2) Normal activation without role change ---
  {
    const suffix = randomUUID().slice(0, 8);
    const issued = await issueInvitation(
      actor,
      {
        kind: "new",
        fullName: `Smoke Role Happy ${suffix}`,
        employeeNumber: `SRH-${suffix}`,
        email: `smoke.role.happy.${suffix}@meridian.local`,
        role: Role.housekeeper,
        department: "Housekeeping",
      },
    );

    const result = await redeemInvitation({
      code: issued.code,
      password: "smoke-pass-1234",
      deviceLabel: "Role Happy Device",
      fingerprint: `fp-happy-${suffix}`,
    });

    assert(
      result.user.role === Role.housekeeper,
      `happy-path role should be housekeeper, got ${result.user.role}`,
    );
    const dbUser = await prisma.user.findUniqueOrThrow({
      where: { id: result.user.id },
    });
    assert(dbUser.role === Role.housekeeper, "DB role should be housekeeper");
    assert(dbUser.activatedAt != null, "user should be activated");

    console.log("normal_activation: ok");
  }

  // --- 3) Already-activated user: redeem must not change current role ---
  {
    const suffix = randomUUID().slice(0, 8);
    const email = `smoke.role.active.${suffix}@meridian.local`;
    const employee = await prisma.employee.create({
      data: {
        fullName: `Smoke Role Active ${suffix}`,
        employeeNumber: `SRA-${suffix}`,
        department: "Housekeeping",
      },
    });
    const user = await prisma.user.create({
      data: {
        employeeId: employee.id,
        email,
        passwordHash: await bcrypt.hash("already-active-pass", 10),
        role: Role.technician,
        activatedAt: new Date(),
        isActive: true,
      },
    });

    const issued = await issueInvitation(
      actor,
      { kind: "existing", employeeId: employee.id },
    );
    assert(
      issued.invitation.role === Role.technician,
      "re-invite should snapshot current technician role",
    );

    await changeRoleLikePeople(user.id, Role.reception);

    const result = await redeemInvitation({
      code: issued.code,
      deviceLabel: "Role Active Device",
      fingerprint: `fp-active-${suffix}`,
    });

    assert(
      result.user.role === Role.reception,
      `already-activated redeem should keep reception, got ${result.user.role}`,
    );
    const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert(
      dbUser.role === Role.reception,
      `DB role should stay reception, got ${dbUser.role}`,
    );

    const consumed = await prisma.invitation.findUniqueOrThrow({
      where: { id: issued.invitation.id },
    });
    assert(
      consumed.status === InvitationStatus.consumed,
      "invite should be consumed",
    );

    console.log("already_activated_keeps_role: ok");
  }

  // --- 4) Rejects: blocked / invalid / expired / used ---
  {
    const suffix = randomUUID().slice(0, 8);

    // Blocked account
    {
      const issued = await issueInvitation(
        actor,
        {
          kind: "new",
          fullName: `Smoke Role Blocked ${suffix}`,
          employeeNumber: `SRB-${suffix}`,
          email: `smoke.role.blocked.${suffix}@meridian.local`,
          role: Role.housekeeper,
        },
      );
      const pending = await prisma.user.findUniqueOrThrow({
        where: { email: issued.invitation.email },
      });
      await prisma.user.update({
        where: { id: pending.id },
        data: { isActive: false },
      });
      await expectReject(
        "blocked",
        () =>
          redeemInvitation({
            code: issued.code,
            password: "smoke-pass-1234",
            deviceLabel: "Blocked Device",
            fingerprint: `fp-blocked-${suffix}`,
          }),
        "forbidden",
      );
    }

    // Invalid code
    await expectReject(
      "invalid",
      () =>
        redeemInvitation({
          code: "ZZZZ-ZZZZ",
          password: "smoke-pass-1234",
          deviceLabel: "Invalid Device",
          fingerprint: `fp-invalid-${suffix}`,
        }),
      "invalid_code",
    );

    // Expired invite
    {
      const email = `smoke.role.expired.${suffix}@meridian.local`;
      const employee = await prisma.employee.create({
        data: {
          fullName: `Smoke Role Expired ${suffix}`,
          employeeNumber: `SRE-${suffix}`,
          department: "Housekeeping",
        },
      });
      await prisma.user.create({
        data: {
          employeeId: employee.id,
          email,
          passwordHash: await bcrypt.hash(
            `pending-${randomBytes(8).toString("hex")}`,
            10,
          ),
          role: Role.housekeeper,
          activatedAt: null,
          isActive: true,
        },
      });
      const code = generateInviteCode();
      await prisma.invitation.create({
        data: {
          codeHash: hashInviteCode(code),
          codeHint: code.slice(-4),
          employeeId: employee.id,
          role: Role.housekeeper,
          email,
          status: InvitationStatus.issued,
          expiresAt: new Date(Date.now() - 60_000),
          createdByUserId: owner.id,
        },
      });
      // expireStaleInvitations may mark status=expired first (invalid_code),
      // or the dedicated expiresAt check may throw expired — both reject.
      await expectReject(
        "expired",
        () =>
          redeemInvitation({
            code,
            password: "smoke-pass-1234",
            deviceLabel: "Expired Device",
            fingerprint: `fp-expired-${suffix}`,
          }),
        ["expired", "invalid_code"],
      );
    }

    // Already used
    {
      const issued = await issueInvitation(
        actor,
        {
          kind: "new",
          fullName: `Smoke Role Used ${suffix}`,
          employeeNumber: `SRU-${suffix}`,
          email: `smoke.role.used.${suffix}@meridian.local`,
          role: Role.housekeeper,
        },
      );
      await redeemInvitation({
        code: issued.code,
        password: "smoke-pass-1234",
        deviceLabel: "Used Device First",
        fingerprint: `fp-used-a-${suffix}`,
      });
      await expectReject(
        "used",
        () =>
          redeemInvitation({
            code: issued.code,
            password: "smoke-pass-1234",
            deviceLabel: "Used Device Second",
            fingerprint: `fp-used-b-${suffix}`,
          }),
        "invalid_code",
      );
    }

    console.log("rejects_blocked_invalid_expired_used: ok");
  }

  console.log("smoke-invitation-role: ok");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
