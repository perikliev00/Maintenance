import { IssueOptionKind, Priority } from "@prisma/client";
import { prisma } from "../../db";
import { snapshotFromCategory } from "./snapshots";

const DEFAULT_CATEGORIES = [
  { key: "climate", nameBg: "Климат", nameEn: "Climate", sortOrder: 0 },
  { key: "electrical", nameBg: "Ел.", nameEn: "Electrical", sortOrder: 1 },
  { key: "furniture", nameBg: "Мебели", nameEn: "Furniture", sortOrder: 2 },
  { key: "plumbing", nameBg: "ВиК", nameEn: "Plumbing", sortOrder: 3 },
  { key: "other", nameBg: "Друго", nameEn: "Other", sortOrder: 4 },
] as const;

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

export async function ensureDefaultMaintenanceCatalog() {
  for (const cat of DEFAULT_CATEGORIES) {
    await prisma.maintenanceCategory.upsert({
      where: { key: cat.key },
      create: { ...cat, isActive: true },
      update: {
        nameBg: cat.nameBg,
        nameEn: cat.nameEn,
        sortOrder: cat.sortOrder,
      },
    });
  }
  const categories = await prisma.maintenanceCategory.findMany();
  const byKey = Object.fromEntries(categories.map((c) => [c.key, c]));

  for (const opt of DEFAULT_OPTIONS) {
    const category = byKey[opt.categoryKey];
    if (!category) continue;
    const existing = await prisma.issueOption.findFirst({
      where: {
        maintenanceCategoryId: category.id,
        nameBg: opt.nameBg,
      },
    });
    if (existing) {
      await prisma.issueOption.update({
        where: { id: existing.id },
        data: {
          kind: opt.kind,
          nameEn: opt.nameEn,
          defaultPriority: opt.defaultPriority ?? null,
          defaultBlocksRoom: opt.defaultBlocksRoom ?? null,
          sortOrder: opt.sortOrder,
          isActive: true,
        },
      });
    } else {
      await prisma.issueOption.create({
        data: {
          maintenanceCategoryId: category.id,
          kind: opt.kind,
          nameBg: opt.nameBg,
          nameEn: opt.nameEn,
          defaultPriority: opt.defaultPriority ?? null,
          defaultBlocksRoom: opt.defaultBlocksRoom ?? null,
          sortOrder: opt.sortOrder,
          isActive: true,
        },
      });
    }
  }

  return { categories, byKey };
}

export function categorySnapshotFromKey(
  byKey: Record<string, { id: string; key: string; nameBg: string; nameEn: string }>,
  categoryKey: string,
) {
  const cat = byKey[categoryKey];
  if (!cat) {
    throw new Error(`Unknown category key: ${categoryKey}`);
  }
  return snapshotFromCategory(cat);
}
