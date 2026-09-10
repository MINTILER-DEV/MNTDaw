import { useState, type ReactElement } from 'react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
export type EditAction = {
  label: string;
  action: () => void;
  disabled?: boolean;
  destructive?: boolean;
  separator?: boolean;
};
export function EditMenu({
  children,
  actions,
  onOpenChange,
}: {
  onOpenChange?: (open: boolean) => void;
  children: ReactElement;
  actions: EditAction[] | (() => EditAction[]);
}) {
  const [resolved, setResolved] = useState<EditAction[]>([]);
  return (
    <ContextMenu
      onOpenChange={(open) => {
        if (open && typeof actions === 'function') setResolved(actions());
        onOpenChange?.(open);
      }}
    >
      <ContextMenuTrigger
        render={children}
        onContextMenu={(event) => event.stopPropagation()}
      />
      <ContextMenuContent className="daw-context-menu">
        {(typeof actions === 'function' ? resolved : actions).map((item) =>
          item.separator ? (
            <ContextMenuSeparator key={item.label} />
          ) : (
            <ContextMenuItem
              key={item.label}
              disabled={item.disabled}
              variant={item.destructive ? 'destructive' : 'default'}
              onClick={item.action}
            >
              {item.label}
            </ContextMenuItem>
          ),
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
