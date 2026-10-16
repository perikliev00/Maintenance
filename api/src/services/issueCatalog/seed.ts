/**
 * Idempotent default maintenance catalog seed (categories + common options).
 * Safe to call on boot; skips keys that already exist.
 */
import { IssueOptionKind, Priority } from "@prisma/client";
import { prisma } from "../../db";
import { snapshotFromCategory } from "./snapshots";

/** Built-in category keys/labels shipped with a fresh install. */
const DEFAULT_CATEGORIES = [
  { key: "climate", nameBg: "Климат", nameEn: "Climate", sortOrder: 0 },
  { key: "electrical", nameBg: "Ел.", nameEn: "Electrical", sortOrder: 1 },
  { key: "furniture", nameBg: "Мебели", nameEn: "Furniture", sortOrder: 2 },
  { key: "plumbing", nameBg: "ВиК", nameEn: "Plumbing", sortOrder: 3 },
  { key: "other", nameBg: "Друго", nameEn: "Other", sortOrder: 4 },
] as const;

/** Built-in issue options keyed by category; matched on nameBg within category. */
const DEFAULT_OPTIONS: Array<{
  categoryKey: (typeof DEFAULT_CATEGORIES)[number]["key"];
  kind: IssueOptionKind;
  nameBg: string;
  nameEn: string;
  defaultPriority?: Priority;
  defaultBlocksRoom?: boolean;
  sortOrder: number;
}> = [
  {
    categoryKey: "climate",
    kind: IssueOptionKind.maintenance,
    nameBg: "Климатик не охлажда",
    nameEn: "AC not cooling",
    defaultPriority: Priority.high,
    defaultBlocksRoom: true,
    sortOrder: 0,
  },
  {
    categoryKey: "climate",
    kind: IssueOptionKind.maintenance,
    nameBg: "Теч от климатик",
    nameEn: "AC leak",
    defaultPriority: Priority.high,
    defaultBlocksRoom: true,
    sortOrder: 1,
  },
  {
    categoryKey: "plumbing",
    kind: IssueOptionKind.maintenance,
    nameBg: "Запушен сифон/мивка",
    nameEn: "Clogged sink",
    defaultPriority: Priority.urgent,
    defaultBlocksRoom: true,
    sortOrder: 0,
  },
  {
    categoryKey: "plumbing",
    kind: IssueOptionKind.maintenance,
    nameBg: "Течещ кран",
    nameEn: "Leaking tap",
    defaultPriority: Priority.normal,
    defaultBlocksRoom: false,
    sortOrder: 1,
  },
  {
    categoryKey: "electrical",
    kind: IssueOptionKind.maintenance,
    nameBg: "Няма ток на контакти",
    nameEn: "No power at sockets",
    defaultPriority: Priority.urgent,
    defaultBlocksRoom: true,
    sortOrder: 0,
  },
  {
    categoryKey: "electrical",
    kind: IssueOptionKind.maintenance,
    nameBg: "Мигаща лампа",
    nameEn: "Flickering light",
    defaultPriority: Priority.normal,
    defaultBlocksRoom: false,
    sortOrder: 1,
  },
  {
    categoryKey: "furniture",
    kind: IssueOptionKind.maintenance,
    nameBg: "Счупена мебел",
    nameEn: "Broken furniture",
    defaultPriority: Priority.normal,
    defaultBlocksRoom: false,
    sortOrder: 0,
  },
  {
    categoryKey: "other",
    kind: IssueOptionKind.housekeeping,
    nameBg: "Петно / миризма",
    nameEn: "Stain / odor",
    defaultPriority: Priority.normal,
    defaultBlocksRoom: false,
    sortOrder: 0,
  },
];

/**
 * Insert default categories/options if missing; no-ops for existing keys.
 * Refreshes labels/sort on existing categories and option defaults on match.
 */
export async function ensureDefaultMaintenanceCatalog() {
  // Upsert categories by key — refresh labels/sort on existing rows.
  for (const cat of DEFAULT_CATEGORIES) {
    // Unique on `key` so re-seed is idempotent across restarts.
    await prisma.maintenanceCategory.upsert({
      where: { key: cat.key },
      // New installs get active categories immediately.
      create: { ...cat, isActive: true },
      // Existing rows: refresh display fields only (keep isActive as-is).
      update: {
        nameBg: cat.nameBg,
        nameEn: cat.nameEn,
        sortOrder: cat.sortOrder,
      },
    });
  }
  // Reload so option inserts resolve maintenanceCategoryId by key.
  const categories = await prisma.maintenanceCategory.findMany();
  // Index by key for O(1) lookup while seeding options.
  const byKey = Object.fromEntries(categories.map((c) => [c.key, c]));

  // Upsert each default option under its category (match on Bulgarian name).
  for (const opt of DEFAULT_OPTIONS) {
    // Resolve parent category id from the post-upsert index.
    const category = byKey[opt.categoryKey];
    // Should not happen after category upsert; skip defensively.
    if (!category) continue;
    // Match existing options by Bulgarian name within the category (stable seed key).
    const existing = await prisma.issueOption.findFirst({
      where: {
        maintenanceCategoryId: category.id,
        nameBg: opt.nameBg,
      },
    });
    // Update path: option already seeded under this category.
    if (existing) {
      // Refresh defaults / kind / sort; keep the option active.
      await prisma.issueOption.update({
        where: { id: existing.id },
        data: {
          kind: opt.kind,
          nameEn: opt.nameEn,
          // Null when seed omits a default priority/blocks flag.
          defaultPriority: opt.defaultPriority ?? null,
          defaultBlocksRoom: opt.defaultBlocksRoom ?? null,
          sortOrder: opt.sortOrder,
          isActive: true,
        },
      });
    } else {
      // First boot (or new option added to seed): insert a fresh row.
      await prisma.issueOption.create({
        data: {
          maintenanceCategoryId: category.id,
          kind: opt.kind,
          nameBg: opt.nameBg,
          nameEn: opt.nameEn,
          // Null when seed omits a default priority/blocks flag.
          defaultPriority: opt.defaultPriority ?? null,
          defaultBlocksRoom: opt.defaultBlocksRoom ?? null,
          sortOrder: opt.sortOrder,
          isActive: true,
        },
      });
    }
  }

  // Callers may use byKey for categorySnapshotFromKey after seed.
  return { categories, byKey };
}

/**
 * Lookup a seeded category by key and return a snapshot (or throw).
 * `byKey` comes from {@link ensureDefaultMaintenanceCatalog}'s return value.
 */
export function categorySnapshotFromKey(
  byKey: Record<string, { id: string; key: string; nameBg: string; nameEn: string }>,
  categoryKey: string,
) {
  // byKey comes from ensureDefaultMaintenanceCatalog's return value.
  const cat = byKey[categoryKey];
  // Unknown key is a programmer error (seed must have created it).
  if (!cat) {
    throw new Error(`Unknown category key: ${categoryKey}`);
  }
  // Freeze into the ticket snapshot shape.
  return snapshotFromCategory(cat);
}
