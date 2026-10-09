import { IssueOptionKind, Priority } from "@prisma/client";
import { prisma } from "../db";
import { AppError } from "../errors";

export type CategorySnapshot = {
  maintenanceCategoryId: string;
  categoryKey: string;
  categoryLabelBg: string;
  categoryLabelEn: string;
};

export async function listCategories(options?: { activeOnly?: boolean }) {
  const activeOnly = options?.activeOnly ?? true;
  return prisma.maintenanceCategory.findMany({
    where: activeOnly ? { isActive: true } : undefined,
    orderBy: [{ sortOrder: "asc" }, { key: "asc" }],
  });
}

export async function createCategory(input: {
  key: string;
  nameBg: string;
  nameEn: string;
  sortOrder?: number;
  isActive?: boolean;
}) {
  const key = input.key.trim().toLowerCase().replace(/\s+/g, "_");
  if (!/^[a-z][a-z0-9_]{0,31}$/.test(key)) {
    throw new AppError(
      400,
      "validation",
      "Category key must be lowercase slug (a-z, 0-9, underscore)",
    );
  }
  const existing = await prisma.maintenanceCategory.findUnique({
    where: { key },
  });
  if (existing) {
    throw new AppError(409, "conflict", "Category key already exists");
  }
  const maxSort = await prisma.maintenanceCategory.aggregate({
    _max: { sortOrder: true },
  });
  return prisma.maintenanceCategory.create({
    data: {
      key,
      nameBg: input.nameBg.trim(),
      nameEn: input.nameEn.trim(),
      sortOrder: input.sortOrder ?? (maxSort._max.sortOrder ?? -1) + 1,
      isActive: input.isActive ?? true,
    },
  });
}

export async function updateCategory(
  id: string,
  input: {
    nameBg?: string;
    nameEn?: string;
    sortOrder?: number;
    isActive?: boolean;
  },
) {
  const row = await prisma.maintenanceCategory.findUnique({ where: { id } });
  if (!row) {
    throw new AppError(404, "not_found", "Category not found");
  }
  return prisma.maintenanceCategory.update({
    where: { id },
    data: {
      ...(input.nameBg !== undefined ? { nameBg: input.nameBg.trim() } : {}),
      ...(input.nameEn !== undefined ? { nameEn: input.nameEn.trim() } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
  });
}

export async function archiveCategory(id: string) {
  const row = await prisma.maintenanceCategory.findUnique({ where: { id } });
  if (!row) {
    throw new AppError(404, "not_found", "Category not found");
  }
  return prisma.maintenanceCategory.update({
    where: { id },
    data: { isActive: false },
  });
}

export async function listIssueOptions(options?: {
  activeOnly?: boolean;
  categoryId?: string;
}) {
  const activeOnly = options?.activeOnly ?? true;
  return prisma.issueOption.findMany({
    where: {
      ...(activeOnly ? { isActive: true } : {}),
      ...(options?.categoryId
        ? { maintenanceCategoryId: options.categoryId }
        : {}),
    },
    include: { maintenanceCategory: true },
    orderBy: [{ sortOrder: "asc" }, { nameBg: "asc" }],
  });
}

export async function createIssueOption(input: {
  maintenanceCategoryId: string;
  kind: IssueOptionKind;
  nameBg: string;
  nameEn: string;
  defaultPriority?: Priority;
  defaultBlocksRoom?: boolean;
  sortOrder?: number;
  isActive?: boolean;
}) {
  const category = await prisma.maintenanceCategory.findUnique({
    where: { id: input.maintenanceCategoryId },
  });
  if (!category) {
    throw new AppError(404, "not_found", "Category not found");
  }
  const maxSort = await prisma.issueOption.aggregate({
    where: { maintenanceCategoryId: input.maintenanceCategoryId },
    _max: { sortOrder: true },
  });
  return prisma.issueOption.create({
    data: {
      maintenanceCategoryId: input.maintenanceCategoryId,
      kind: input.kind,
      nameBg: input.nameBg.trim(),
      nameEn: input.nameEn.trim(),
      defaultPriority: input.defaultPriority ?? null,
      defaultBlocksRoom: input.defaultBlocksRoom ?? null,
      sortOrder: input.sortOrder ?? (maxSort._max.sortOrder ?? -1) + 1,
      isActive: input.isActive ?? true,
    },
    include: { maintenanceCategory: true },
  });
}

export async function updateIssueOption(
  id: string,
  input: {
    maintenanceCategoryId?: string;
    kind?: IssueOptionKind;
    nameBg?: string;
    nameEn?: string;
    defaultPriority?: Priority | null;
    defaultBlocksRoom?: boolean | null;
    sortOrder?: number;
    isActive?: boolean;
  },
) {
  const row = await prisma.issueOption.findUnique({ where: { id } });
  if (!row) {
    throw new AppError(404, "not_found", "Issue option not found");
  }
  if (input.maintenanceCategoryId) {
    const category = await prisma.maintenanceCategory.findUnique({
      where: { id: input.maintenanceCategoryId },
    });
    if (!category) {
      throw new AppError(404, "not_found", "Category not found");
    }
  }
  return prisma.issueOption.update({
    where: { id },
    data: {
      ...(input.maintenanceCategoryId !== undefined
        ? { maintenanceCategoryId: input.maintenanceCategoryId }
        : {}),
      ...(input.kind !== undefined ? { kind: input.kind } : {}),
      ...(input.nameBg !== undefined ? { nameBg: input.nameBg.trim() } : {}),
      ...(input.nameEn !== undefined ? { nameEn: input.nameEn.trim() } : {}),
      ...(input.defaultPriority !== undefined
        ? { defaultPriority: input.defaultPriority }
        : {}),
      ...(input.defaultBlocksRoom !== undefined
        ? { defaultBlocksRoom: input.defaultBlocksRoom }
        : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
    include: { maintenanceCategory: true },
  });
}

export async function archiveIssueOption(id: string) {
  const row = await prisma.issueOption.findUnique({ where: { id } });
  if (!row) {
    throw new AppError(404, "not_found", "Issue option not found");
  }
  return prisma.issueOption.update({
    where: { id },
    data: { isActive: false },
    include: { maintenanceCategory: true },
  });
}

export async function reorderIssueOptions(orderedIds: string[]) {
  if (!orderedIds.length) {
    throw new AppError(400, "validation", "ids must not be empty");
  }
  const rows = await prisma.issueOption.findMany({
    where: { id: { in: orderedIds } },
    select: { id: true },
  });
  if (rows.length !== orderedIds.length) {
    throw new AppError(400, "validation", "Unknown issue option id in list");
  }
  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.issueOption.update({
        where: { id },
        data: { sortOrder: index },
      }),
    ),
  );
  return listIssueOptions({ activeOnly: false });
}

export async function resolveCategorySnapshot(
  categoryId: string,
  requireActive = true,
): Promise<CategorySnapshot> {
  const category = await prisma.maintenanceCategory.findUnique({
    where: { id: categoryId },
  });
  if (!category) {
    throw new AppError(404, "not_found", "Category not found");
  }
  if (requireActive && !category.isActive) {
    throw new AppError(409, "invalid_state", "Category is not active");
  }
  return {
    maintenanceCategoryId: category.id,
    categoryKey: category.key,
    categoryLabelBg: category.nameBg,
    categoryLabelEn: category.nameEn,
  };
}

export async function getActiveIssueOption(id: string) {
  const option = await prisma.issueOption.findUnique({
    where: { id },
    include: { maintenanceCategory: true },
  });
  if (!option) {
    throw new AppError(404, "not_found", "Issue option not found");
  }
  if (!option.isActive) {
    throw new AppError(409, "invalid_state", "Issue option is not active");
  }
  if (!option.maintenanceCategory.isActive) {
    throw new AppError(409, "invalid_state", "Category is not active");
  }
  return option;
}

export function snapshotFromCategory(category: {
  id: string;
  key: string;
  nameBg: string;
  nameEn: string;
}): CategorySnapshot {
  return {
    maintenanceCategoryId: category.id,
    categoryKey: category.key,
    categoryLabelBg: category.nameBg,
    categoryLabelEn: category.nameEn,
  };
}

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
