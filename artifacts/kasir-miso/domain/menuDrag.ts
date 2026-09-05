export type MenuLayout = { y: number; height: number };
export type ActiveMenuDrag = { current: { id: string; index: number } | null };
export type MenuDragGesture = { dy: number; dx: number };

type MenuDragHandlerOptions = {
  menus: readonly { id: string }[];
  menuId: string;
  menuIndex: number;
  menuLayouts: Record<string, MenuLayout>;
  activeDrag: ActiveMenuDrag;
  onDragStart: () => void;
  onDragMove: (dy: number) => void;
  onDragEnd: () => void;
  onDragCancel: () => void;
  reorderMenus: (id: string, toIndex: number) => void;
};

export function getMenuDropIndex(
  menus: readonly { id: string }[],
  draggedId: string,
  gestureDy: number,
  menuLayouts: Record<string, MenuLayout>,
) {
  const draggedIndex = menus.findIndex((menu) => menu.id === draggedId);
  if (draggedIndex < 0 || menus.length === 0) return 0;

  const draggedLayout = menuLayouts[draggedId];
  const pointerY = (draggedLayout?.y ?? draggedIndex * 77)
    + (draggedLayout?.height ?? 68) / 2
    + gestureDy;
  let targetIndex = 0;

  menus.forEach((candidate, candidateIndex) => {
    const candidateLayout = menuLayouts[candidate.id];
    const centerY = (candidateLayout?.y ?? candidateIndex * 77)
      + (candidateLayout?.height ?? 68) / 2;
    if (pointerY > centerY) targetIndex = candidateIndex;
  });

  return Math.max(0, Math.min(menus.length - 1, targetIndex));
}

export function createMenuDragHandlers({
  menus,
  menuId,
  menuIndex,
  menuLayouts,
  activeDrag,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDragCancel,
  reorderMenus,
}: MenuDragHandlerOptions) {
  return {
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_event: unknown, gesture: MenuDragGesture) => (
      Math.abs(gesture.dy) > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx)
    ),
    onPanResponderGrant: () => {
      activeDrag.current = { id: menuId, index: menuIndex };
      onDragStart();
    },
    onPanResponderMove: (_event: unknown, gesture: MenuDragGesture) => {
      if (activeDrag.current?.id === menuId) onDragMove(gesture.dy);
    },
    onPanResponderRelease: (_event: unknown, gesture: MenuDragGesture) => {
      const drag = activeDrag.current;
      if (!drag || drag.id !== menuId) return;

      const targetIndex = getMenuDropIndex(menus, menuId, gesture.dy, menuLayouts);
      reorderMenus(menuId, targetIndex);
      activeDrag.current = null;
      onDragEnd();
    },
    onPanResponderTerminate: () => {
      const drag = activeDrag.current;
      if (!drag || drag.id !== menuId) return;

      activeDrag.current = null;
      onDragCancel();
    },
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
  };
}