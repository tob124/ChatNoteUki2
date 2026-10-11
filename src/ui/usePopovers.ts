import { useEffect } from "react";

/** Only transient menus participate; reading accordions keep their open state. */
export function usePopovers() {
  useEffect(() => {
    const selector = "details[data-popover][open]";
    const openMenus = () => [
      ...document.querySelectorAll<HTMLDetailsElement>(selector),
    ];
    const outside = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      for (const menu of openMenus())
        if (!menu.contains(event.target)) menu.open = false;
    };
    const toggle = (event: Event) => {
      const current = event.target;
      if (
        !(current instanceof HTMLDetailsElement) ||
        !current.hasAttribute("data-popover") ||
        !current.open
      )
        return;
      for (const menu of openMenus())
        if (
          menu !== current &&
          !menu.contains(current) &&
          !current.contains(menu)
        )
          menu.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !(event.target instanceof Element)) return;
      const menu = event.target.closest<HTMLDetailsElement>(selector);
      if (!menu) return;
      event.preventDefault();
      event.stopPropagation();
      menu.open = false;
      menu.querySelector<HTMLElement>(":scope > summary")?.focus();
    };
    const leave = (event: FocusEvent) => {
      if (!(event.relatedTarget instanceof Node)) return;
      for (const menu of openMenus())
        if (
          menu.contains(event.target as Node) &&
          !menu.contains(event.relatedTarget)
        )
          menu.open = false;
    };
    const action = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const button = event.target.closest("button");
      const menu = button?.closest<HTMLDetailsElement>(
        "details[data-close-on-action]",
      );
      if (!menu) return;
      // Establish a visible return target before a modal is opened by React.
      menu.open = false;
      menu.querySelector<HTMLElement>(":scope > summary")?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("toggle", toggle, true);
    document.addEventListener("keydown", escape, true);
    document.addEventListener("focusout", leave);
    document.addEventListener("click", action, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("toggle", toggle, true);
      document.removeEventListener("keydown", escape, true);
      document.removeEventListener("focusout", leave);
      document.removeEventListener("click", action, true);
    };
  }, []);
}
