import { useEffect } from "react";

/** React may remove a dialog before native close() can restore its trigger. */
export function useDialogFocus(open = true) {
  useEffect(() => {
    if (!open) return;
    const origin = document.activeElement;
    return () => {
      requestAnimationFrame(() => {
        if (!(origin instanceof HTMLElement) || !origin.isConnected) return;
        const modal = document.querySelector("dialog[open]");
        if (!modal || modal.contains(origin))
          origin.focus({ preventScroll: true });
      });
    };
  }, [open]);
}
