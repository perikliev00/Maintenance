/**
 * Idempotent default maintenance catalog seed (categories + common options).
 * Safe to call on boot; skips keys that already exist.
 */
import { IssueOptionKind, Priority } from "@prisma/client";
// Import module ../../db for this service.
import { prisma } from "../../db";
// Import module ./snapshots for this service.
import { snapshotFromCategory } from "./snapshots";

/** Built-in category keys/labels shipped with a fresh install. */
const DEFAULT_CATEGORIES = [
  // Run next step: { key: "climate", nameBg: "Климат", nameEn: "Climate", sortO…
  { key: "climate", nameBg: "Климат", nameEn: "Climate", sortOrder: 0 },
  // Run next step: { key: "electrical", nameBg: "Ел.", nameEn: "Electrical", so…
  { key: "electrical", nameBg: "Ел.", nameEn: "Electrical", sortOrder: 1 },
  // Run next step: { key: "furniture", nameBg: "Мебели", nameEn: "Furniture", s…
  { key: "furniture", nameBg: "Мебели", nameEn: "Furniture", sortOrder: 2 },
  // Run next step: { key: "plumbing", nameBg: "ВиК", nameEn: "Plumbing", sortOr…
  { key: "plumbing", nameBg: "ВиК", nameEn: "Plumbing", sortOrder: 3 },
  // Run next step: { key: "other", nameBg: "Друго", nameEn: "Other", sortOrder:…
  { key: "other", nameBg: "Друго", nameEn: "Other", sortOrder: 4 },
// Run next step: ] as const;
] as const;

/** Built-in issue options keyed by category; matched on nameBg within category. */
const DEFAULT_OPTIONS: Array<{
  // Set categoryKey on the structure being built.
  categoryKey: (typeof DEFAULT_CATEGORIES)[number]["key"];
  // Set kind on the structure being built.
  kind: IssueOptionKind;
  // Set nameBg on the structure being built.
  nameBg: string;
  // Set nameEn on the structure being built.
  nameEn: string;
  // Run next step: defaultPriority?: Priority;
  defaultPriority?: Priority;
  // Run next step: defaultBlocksRoom?: boolean;
  defaultBlocksRoom?: boolean;
  // Set sortOrder on the structure being built.
  sortOrder: number;
// Run next step: }> = [
}> = [
  // Run next step: {
  {
    // Set categoryKey on the structure being built.
    categoryKey: "climate",
    // Set kind on the structure being built.
    kind: IssueOptionKind.maintenance,
    // Set nameBg on the structure being built.
    nameBg: "Климатик не охлажда",
    // Set nameEn on the structure being built.
    nameEn: "AC not cooling",
    // Set defaultPriority on the structure being built.
    defaultPriority: Priority.high,
    // Set defaultBlocksRoom on the structure being built.
    defaultBlocksRoom: true,
    // Set sortOrder on the structure being built.
    sortOrder: 0,
  },
  // Run next step: {
  {
    // Set categoryKey on the structure being built.
    categoryKey: "climate",
    // Set kind on the structure being built.
    kind: IssueOptionKind.maintenance,
    // Set nameBg on the structure being built.
    nameBg: "Теч от климатик",
    // Set nameEn on the structure being built.
    nameEn: "AC leak",
    // Set defaultPriority on the structure being built.
    defaultPriority: Priority.high,
    // Set defaultBlocksRoom on the structure being built.
    defaultBlocksRoom: true,
    // Set sortOrder on the structure being built.
    sortOrder: 1,
  },
  // Run next step: {
  {
    // Set categoryKey on the structure being built.
    categoryKey: "plumbing",
    // Set kind on the structure being built.
    kind: IssueOptionKind.maintenance,
    // Set nameBg on the structure being built.
    nameBg: "Запушен сифон/мивка",
    // Set nameEn on the structure being built.
    nameEn: "Clogged sink",
    // Set defaultPriority on the structure being built.
    defaultPriority: Priority.urgent,
    // Set defaultBlocksRoom on the structure being built.
    defaultBlocksRoom: true,
    // Set sortOrder on the structure being built.
    sortOrder: 0,
  },
  // Run next step: {
  {
    // Set categoryKey on the structure being built.
    categoryKey: "plumbing",
    // Set kind on the structure being built.
    kind: IssueOptionKind.maintenance,
    // Set nameBg on the structure being built.
    nameBg: "Течещ кран",
    // Set nameEn on the structure being built.
    nameEn: "Leaking tap",
    // Set defaultPriority on the structure being built.
    defaultPriority: Priority.normal,
    // Set defaultBlocksRoom on the structure being built.
    defaultBlocksRoom: false,
    // Set sortOrder on the structure being built.
    sortOrder: 1,
  },
  // Run next step: {
  {
    // Set categoryKey on the structure being built.
    categoryKey: "electrical",
    // Set kind on the structure being built.
    kind: IssueOptionKind.maintenance,
    // Set nameBg on the structure being built.
    nameBg: "Няма ток на контакти",
    // Set nameEn on the structure being built.
    nameEn: "No power at sockets",
    // Set defaultPriority on the structure being built.
    defaultPriority: Priority.urgent,
    // Set defaultBlocksRoom on the structure being built.
    defaultBlocksRoom: true,
    // Set sortOrder on the structure being built.
    sortOrder: 0,
  },
  // Run next step: {
  {
    // Set categoryKey on the structure being built.
    categoryKey: "electrical",
    // Set kind on the structure being built.
    kind: IssueOptionKind.maintenance,
    // Set nameBg on the structure being built.
    nameBg: "Мигаща лампа",
    // Set nameEn on the structure being built.
    nameEn: "Flickering light",
    // Set defaultPriority on the structure being built.
    defaultPriority: Priority.normal,
    // Set defaultBlocksRoom on the structure being built.
    defaultBlocksRoom: false,
    // Set sortOrder on the structure being built.
    sortOrder: 1,
  },
  // Run next step: {
  {
    // Set categoryKey on the structure being built.
    categoryKey: "furniture",
    // Set kind on the structure being built.
    kind: IssueOptionKind.maintenance,
    // Set nameBg on the structure being built.
    nameBg: "Счупена мебел",
    // Set nameEn on the structure being built.
    nameEn: "Broken furniture",
    // Set defaultPriority on the structure being built.
    defaultPriority: Priority.normal,
    // Set defaultBlocksRoom on the structure being built.
    defaultBlocksRoom: false,
    // Set sortOrder on the structure being built.
    sortOrder: 0,
  },
  // Run next step: {
  {
    // Set categoryKey on the structure being built.
    categoryKey: "other",
    // Set kind on the structure being built.
    kind: IssueOptionKind.housekeeping,
    // Set nameBg on the structure being built.
    nameBg: "Петно / миризма",
    // Set nameEn on the structure being built.
    nameEn: "Stain / odor",
    // Set defaultPriority on the structure being built.
    defaultPriority: Priority.normal,
    // Set defaultBlocksRoom on the structure being built.
    defaultBlocksRoom: false,
    // Set sortOrder on the structure being built.
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
      // Set where on the structure being built.
      where: { key: cat.key },
      // New installs get active categories immediately.
      create: { ...cat, isActive: true },
      // Existing rows: refresh display fields only (keep isActive as-is).
      update: {
        // Set nameBg on the structure being built.
        nameBg: cat.nameBg,
        // Set nameEn on the structure being built.
        nameEn: cat.nameEn,
        // Set sortOrder on the structure being built.
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
      // Set where on the structure being built.
      where: {
        // Set maintenanceCategoryId on the structure being built.
        maintenanceCategoryId: category.id,
        // Set nameBg on the structure being built.
        nameBg: opt.nameBg,
      },
    });
    // Update path: option already seeded under this category.
    if (existing) {
      // Refresh defaults / kind / sort; keep the option active.
      await prisma.issueOption.update({
        // Set where on the structure being built.
        where: { id: existing.id },
        // Set data on the structure being built.
        data: {
          // Set kind on the structure being built.
          kind: opt.kind,
          // Set nameEn on the structure being built.
          nameEn: opt.nameEn,
          // Null when seed omits a default priority/blocks flag.
          defaultPriority: opt.defaultPriority ?? null,
          // Set defaultBlocksRoom on the structure being built.
          defaultBlocksRoom: opt.defaultBlocksRoom ?? null,
          // Set sortOrder on the structure being built.
          sortOrder: opt.sortOrder,
          // Set isActive on the structure being built.
          isActive: true,
        },
      });
    // Run next step: } else {
    } else {
      // First boot (or new option added to seed): insert a fresh row.
      await prisma.issueOption.create({
        // Set data on the structure being built.
        data: {
          // Set maintenanceCategoryId on the structure being built.
          maintenanceCategoryId: category.id,
          // Set kind on the structure being built.
          kind: opt.kind,
          // Set nameBg on the structure being built.
          nameBg: opt.nameBg,
          // Set nameEn on the structure being built.
          nameEn: opt.nameEn,
          // Null when seed omits a default priority/blocks flag.
          defaultPriority: opt.defaultPriority ?? null,
          // Set defaultBlocksRoom on the structure being built.
          defaultBlocksRoom: opt.defaultBlocksRoom ?? null,
          // Set sortOrder on the structure being built.
          sortOrder: opt.sortOrder,
          // Set isActive on the structure being built.
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
  // Set byKey on the structure being built.
  byKey: Record<string, { id: string; key: string; nameBg: string; nameEn: string }>,
  // Set categoryKey on the structure being built.
  categoryKey: string,
// Run next step: ) {
) {
  // byKey comes from ensureDefaultMaintenanceCatalog's return value.
  const cat = byKey[categoryKey];
  // Unknown key is a programmer error (seed must have created it).
  if (!cat) {
    // Abort with an error so callers can react.
    throw new Error(`Unknown category key: ${categoryKey}`);
  }
  // Freeze into the ticket snapshot shape.
  return snapshotFromCategory(cat);
}
