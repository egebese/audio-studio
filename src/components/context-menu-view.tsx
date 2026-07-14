"use client";

import * as React from "react";

export interface MenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  hint?: string;
}

export interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

export function ContextMenuView({ menu, onClose }: { menu: MenuState; onClose: () => void }) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = React.useState({ x: menu.x, y: menu.y });

  React.useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    setPosition({
      x: Math.min(menu.x, Math.max(8, window.innerWidth - rect.width - 8)),
      y: Math.min(menu.y, Math.max(8, window.innerHeight - rect.height - 8))
    });
  }, [menu]);

  return (
    <div
      ref={ref}
      className="context-menu"
      style={{ left: position.x, top: position.y }}
      onClick={(event) => event.stopPropagation()}
    >
      {menu.items.map((item) => (
        <button
          key={item.label}
          type="button"
          className={item.danger ? "danger" : ""}
          disabled={item.disabled}
          title={item.hint}
          onClick={() => {
            item.onSelect();
            onClose();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
