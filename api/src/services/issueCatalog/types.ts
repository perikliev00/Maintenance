/**
 * Frozen category labels copied onto tickets at create time so later catalog
 * renames do not rewrite historical ticket category text.
 */
export type CategorySnapshot = {
  // Set maintenanceCategoryId on the structure being built.
  maintenanceCategoryId: string;
  // Set categoryKey on the structure being built.
  categoryKey: string;
  // Set categoryLabelBg on the structure being built.
  categoryLabelBg: string;
  // Set categoryLabelEn on the structure being built.
  categoryLabelEn: string;
};
