/** Screener categories, in the order they appear in a brief. */
export const CATEGORIES = [
  { id: "needs_reply", label: "Needs you" },
  { id: "calendar", label: "Calendar" },
  { id: "payments", label: "Payments" },
  { id: "orders", label: "Orders & deliveries" },
  { id: "travel", label: "Travel" },
  { id: "security", label: "Security" },
  { id: "work", label: "Work & projects" },
  { id: "personal", label: "Friends & family" },
  { id: "newsletters", label: "Newsletters" },
  { id: "notifications", label: "Notifications" },
  { id: "promotions", label: "Promotions" },
  { id: "fyi", label: "FYI" },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]["id"];
export const CATEGORY_IDS = CATEGORIES.map((c) => c.id) as [CategoryId, ...CategoryId[]];

export function categoryLabel(id: string): string {
  return CATEGORIES.find((c) => c.id === id)?.label ?? "Other";
}

export function categoryOrder(id: string): number {
  const i = CATEGORIES.findIndex((c) => c.id === id);
  return i === -1 ? CATEGORIES.length : i;
}

/** "Morning" / "Afternoon" / "Evening" for a local HH:MM brief time. */
export function slotLabel(time: string): string {
  if (time < "12:00") return "Morning";
  if (time < "17:00") return "Afternoon";
  return "Evening";
}
