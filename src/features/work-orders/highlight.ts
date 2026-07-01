import { cn } from "@/lib/utils";

export const WO_HIGHLIGHT_TARGET = "wo-highlight-target";
export const WO_HIGHLIGHT_ACTIVE = "wo-highlight-active";
export const WO_HIGHLIGHTING_BODY = "wo-highlighting";

let highlightFrame = 0;

export function setWorkOrderHighlight(number: string | null) {
  if (typeof document === "undefined") return;

  cancelAnimationFrame(highlightFrame);
  highlightFrame = requestAnimationFrame(() => {
    const body = document.body;

    if (!number) {
      body.classList.remove(WO_HIGHLIGHTING_BODY);
      body.removeAttribute("data-work-order-highlight");
      document
        .querySelectorAll(`.${WO_HIGHLIGHT_ACTIVE}`)
        .forEach((el) => el.classList.remove(WO_HIGHLIGHT_ACTIVE));
      return;
    }

    body.classList.add(WO_HIGHLIGHTING_BODY);
    body.setAttribute("data-work-order-highlight", number);

    document.querySelectorAll("[data-work-order]").forEach((el) => {
      const match = el.getAttribute("data-work-order") === number;
      el.classList.toggle(WO_HIGHLIGHT_ACTIVE, match);
    });
  });
}

export function workOrderHighlightHoverHandlers(number: string) {
  return {
    onMouseEnter: () => setWorkOrderHighlight(number),
    onMouseLeave: () => setWorkOrderHighlight(null),
  };
}

/** Marks a task row/card so it reacts to work-order badge hover. */
export function withWorkOrderHighlight(
  number: string | null | undefined,
  className?: string,
): { className: string; "data-work-order"?: string } {
  if (!number) return { className: className ?? "" };
  return {
    className: cn(className, WO_HIGHLIGHT_TARGET),
    "data-work-order": number,
  };
}

/** @deprecated Use withWorkOrderHighlight */
export const mergeWorkOrderHighlight = withWorkOrderHighlight;
