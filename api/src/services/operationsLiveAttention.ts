/**
 * Needs-attention kind metadata for operations live board (i18n keys + defaults).
 */
export type NeedsAttentionKind =
  | "awaiting_inspection"
  | "past_due"
  | "blocking_ticket";

export const ATTENTION_KIND_META: Record<
  NeedsAttentionKind,
  {
    titleKey: "inspection_needed" | "past_due" | "custom";
    defaultTitle: string;
  }
> = {
  awaiting_inspection: {
    titleKey: "inspection_needed",
    defaultTitle: "Inspection needed",
  },
  past_due: {
    titleKey: "past_due",
    defaultTitle: "Past due",
  },
  blocking_ticket: {
    titleKey: "custom",
    defaultTitle: "",
  },
};

export function attentionTitleForKind(
  kind: Exclude<NeedsAttentionKind, "blocking_ticket">,
): { titleKey: "inspection_needed" | "past_due"; title: string } {
  const meta = ATTENTION_KIND_META[kind];
  return {
    titleKey: meta.titleKey as "inspection_needed" | "past_due",
    title: meta.defaultTitle,
  };
}
