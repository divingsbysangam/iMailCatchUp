import { createContext, useContext, type MouseEvent } from "react";

/** Opens an email in the pop-up. Provided by App; falls back to full-page navigation. */
export const OpenMessageContext = createContext<(id: number) => void>((id) => {
  window.location.hash = `#/messages/${id}`;
});

/** Props for a link that opens an email in the pop-up (a real href keeps "open in new tab" working). */
export function useMessageLink() {
  const open = useContext(OpenMessageContext);
  return {
    open,
    linkProps: (id: number) => ({
      href: `#/messages/${id}`,
      onClick: (e: MouseEvent) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // let the browser open a tab
        e.preventDefault();
        open(id);
      },
    }),
    /** For a whole row: opens unless the click landed on a button or link inside it. */
    rowClick: (id: number) => (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest("button, a, summary")) return;
      open(id);
    },
  };
}
