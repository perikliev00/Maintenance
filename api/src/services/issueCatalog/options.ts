import { IssueOptionKind, Priority } from "@prisma/client";
import { prisma } from "../../db";
import { AppError } from "../../errors";

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
