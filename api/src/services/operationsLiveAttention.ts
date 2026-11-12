/**
 * Needs-attention kind metadata for operations live board (i18n keys + defaults).
 */
export type NeedsAttentionKind =
  // Run next step: | "awaiting_inspection"
  | "awaiting_inspection"
  // Run next step: | "past_due"
  | "past_due"
  // Run next step: | "blocking_ticket";
  | "blocking_ticket";

// Export ATTENTION_KIND_META for reuse by other modules.
export const ATTENTION_KIND_META: Record<
  // Run next step: NeedsAttentionKind,
  NeedsAttentionKind,
  // Run next step: {
  {
    // Set titleKey on the structure being built.
    titleKey: "inspection_needed" | "past_due" | "custom";
    // Set defaultTitle on the structure being built.
    defaultTitle: string;
  }
// Run next step: > = {
> = {
  // Set awaiting_inspection on the structure being built.
  awaiting_inspection: {
    // Set titleKey on the structure being built.
    titleKey: "inspection_needed",
    // Set defaultTitle on the structure being built.
    defaultTitle: "Inspection needed",
  },
  // Set past_due on the structure being built.
  past_due: {
    // Set titleKey on the structure being built.
    titleKey: "past_due",
    // Set defaultTitle on the structure being built.
    defaultTitle: "Past due",
  },
  // Set blocking_ticket on the structure being built.
  blocking_ticket: {
    // Set titleKey on the structure being built.
    titleKey: "custom",
    // Set defaultTitle on the structure being built.
    defaultTitle: "",
  },
};

// Define attentionTitleForKind — core behavior for this module.
export function attentionTitleForKind(
  // Set kind on the structure being built.
  kind: Exclude<NeedsAttentionKind, "blocking_ticket">,
// Run next step: ): { titleKey: "inspection_needed" | "past_due"; title: stri…
): { titleKey: "inspection_needed" | "past_due"; title: string } {
  // Capture meta for use in this scope.
  const meta = ATTENTION_KIND_META[kind];
  // Return the computed result to the caller.
  return {
    // Set titleKey on the structure being built.
    titleKey: meta.titleKey as "inspection_needed" | "past_due",
    // Set title on the structure being built.
    title: meta.defaultTitle,
  };
}
