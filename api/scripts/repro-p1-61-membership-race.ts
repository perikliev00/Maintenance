/**
 * P1-61 before-fix reproduction against production setSectorLocations / HTTP.
 * Barrier: hold Location FOR UPDATE, start two real setSectorLocations (or HTTP PUTs).
 * Does not replace business logic.
 *
 * Usage: npx tsx scripts/repro-p1-61-membership-race.ts
 */
import path from "node:path";
import { PrismaClient, Role } from "@prisma/client";
import dotenv from "dotenv";
import {
  closeServer,
  listenApp,
  loginBearer,
  putJson,
} from "../tests/httpHarness";
import {
  cleanupSectorsWorld,
  createSectorsWorld,
  membershipSnapshot,
  resetSectorMemberships,
  waitForBlockedByHolder,
  type SectorsWorld,
} from "../tests/sectors/fixtures";
import { setSectorLocations } from "../src/services/sectors/commands";
import type { DataScope } from "../src/services/dataScope";

dotenv.config({
  path: path.resolve(__dirname, "../.env"),
  override: true,
});

const prisma = new PrismaClient();

function allScope(employeeId = ""): DataScope {
  return {
    kind: "all",
    employeeId,
    role: Role.manager,
    sectorIds: [],
  };
}

async function dualClaimService(world: SectorsWorld) {
  await resetSectorMemberships(prisma, world);
  // Move L1 to a neutral starting sector owned by manager path — start from A1.
  const before = await membershipSnapshot(prisma, [world.loc1Id]);

  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  let holderPid: number | null = null;
  let lockHeld = false;

  const holder = prisma.$transaction(
    async (tx) => {
      const pidRows = await tx.$queryRaw<{ pid: number }[]>`
        SELECT pg_backend_pid()::int AS pid
      `;
      holderPid = pidRows[0]!.pid;
      await tx.$executeRaw`
        SELECT id FROM "Location" WHERE id = ${world.loc1Id} FOR UPDATE
      `;
      lockHeld = true;
      await gate;
    },
    { timeout: 30_000, maxWait: 30_000 },
  );

  for (let i = 0; i < 100 && !lockHeld; i += 1) {
    await new Promise((r) => setTimeout(r, 20));
  }
  if (!lockHeld || holderPid == null) {
    release();
    await holder.catch(() => undefined);
    throw new Error("holder failed to lock");
  }

  const auth = {
    scope: allScope(world.manager.employeeId),
    allowCrossSectorTransfer: true,
  };

  const p1 = setSectorLocations(world.sectorA2Id, [world.loc1Id, world.loc3Id], {
    actorEmployeeId: world.manager.employeeId,
    ...auth,
  });
  const p2 = setSectorLocations(
    world.sectorForeignId,
    [world.loc1Id, world.loc4Id],
    {
      actorEmployeeId: world.manager.employeeId,
      ...auth,
    },
  );

  const blocked = await waitForBlockedByHolder(prisma, holderPid, 1);
  console.log(
    JSON.stringify({
      phase: "service-dual-claim-blocked",
      holderPid,
      blockedPids: blocked,
    }),
  );

  release();
  await holder;

  const settled = await Promise.allSettled([p1, p2]);
  const after = await membershipSnapshot(prisma, [world.loc1Id]);
  const loc1Sectors = await prisma.sectorLocation.findMany({
    where: { locationId: world.loc1Id },
  });

  const results = settled.map((s) => {
    if (s.status === "fulfilled") return { ok: true };
    const err = s.reason as { status?: number; code?: string; message?: string; name?: string };
    return {
      ok: false,
      status: err?.status,
      code: err?.code,
      message: err?.message,
      name: err?.name,
      prismaCode: (err as { code?: string })?.code,
      raw: String(s.reason),
    };
  });

  console.log(
    JSON.stringify(
      {
        phase: "service-dual-claim-result",
        before: Object.fromEntries(before),
        after: Object.fromEntries(after),
        loc1MembershipCount: loc1Sectors.length,
        results,
      },
      null,
      2,
    ),
  );
}

async function dualClaimHttp(world: SectorsWorld) {
  await resetSectorMemberships(prisma, world);
  const { server, api } = await listenApp();
  try {
    const mgr = await loginBearer(
      api,
      world.manager.email,
      world.password,
    );

    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let holderPid: number | null = null;
    let lockHeld = false;

    const holder = prisma.$transaction(
      async (tx) => {
        const pidRows = await tx.$queryRaw<{ pid: number }[]>`
          SELECT pg_backend_pid()::int AS pid
        `;
        holderPid = pidRows[0]!.pid;
        await tx.$executeRaw`
          SELECT id FROM "Location" WHERE id = ${world.loc1Id} FOR UPDATE
        `;
        lockHeld = true;
        await gate;
      },
      { timeout: 30_000, maxWait: 30_000 },
    );

    for (let i = 0; i < 100 && !lockHeld; i += 1) {
      await new Promise((r) => setTimeout(r, 20));
    }
    if (!lockHeld || holderPid == null) {
      release();
      await holder.catch(() => undefined);
      throw new Error("holder failed to lock");
    }

    const h1 = putJson(api, mgr.token, `/sectors/${world.sectorA2Id}/locations`, {
      locationIds: [world.loc1Id, world.loc3Id],
    });
    const h2 = putJson(
      api,
      mgr.token,
      `/sectors/${world.sectorForeignId}/locations`,
      { locationIds: [world.loc1Id, world.loc4Id] },
    );

    const blocked = await waitForBlockedByHolder(prisma, holderPid, 1).catch(
      () => [] as number[],
    );
    console.log(
      JSON.stringify({
        phase: "http-dual-claim-blocked",
        holderPid,
        blockedPids: blocked,
      }),
    );

    release();
    await holder;

    const [r1, r2] = await Promise.all([h1, h2]);
    const loc1Sectors = await prisma.sectorLocation.findMany({
      where: { locationId: world.loc1Id },
    });

    console.log(
      JSON.stringify(
        {
          phase: "http-dual-claim-result",
          responses: [
            { status: r1.status, body: r1.body },
            { status: r2.status, body: r2.body },
          ],
          loc1MembershipCount: loc1Sectors.length,
        },
        null,
        2,
      ),
    );
  } finally {
    await closeServer(server);
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL required");
  }
  console.log(
    JSON.stringify({
      phase: "start",
      note: "P1-61 repro before membership locks",
    }),
  );
  const world = await createSectorsWorld(prisma);
  try {
    await dualClaimService(world);
    await dualClaimHttp(world);
  } finally {
    await cleanupSectorsWorld(prisma, world);
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
