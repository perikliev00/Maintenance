/**
 * Frozen category labels copied onto tickets at create time so later catalog
 * renames do not rewrite historical ticket category text.
 */
export type CategorySnapshot = {
  maintenanceCategoryId: string;
  categoryKey: string;
  categoryLabelBg: string;
  categoryLabelEn: string;
};
