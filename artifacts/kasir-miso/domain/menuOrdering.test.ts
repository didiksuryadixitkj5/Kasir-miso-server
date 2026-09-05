import { describe, expect, it, vi } from 'vitest';
import type { ConsignmentItem, MenuItem, WarungState } from '@/context/WarungContext';
import { buildCatalogItems } from './menuCatalog';
import { createMenuDragHandlers, type ActiveMenuDrag } from './menuDrag';
import {
  hydrateWarungState,
  reorderMenuItems,
  WARUNG_STATE_STORAGE_KEY,
} from './menuOrdering';

const menus: MenuItem[] = [
  { id: 'mie', name: 'Mie Ayam', price: 12_000, recipe: {} },
  { id: 'bakso', name: 'Bakso', price: 14_000, recipe: {} },
  { id: 'es-teh', name: 'Es Teh', price: 5_000, recipe: {} },
];

const consignments: ConsignmentItem[] = [];

function stateWithMenus(menuItems: MenuItem[]): WarungState {
  return {
    menus: menuItems,
    activeOrders: [],
    kitchenOrders: [],
    inventory: [],
    consignments,
    expenses: [],
    sales: [],
    savingsRules: [],
    savingsEntries: [],
  };
}

describe('menu order persistence', () => {
  it('keeps a dragged menu order after storage is rehydrated and used by Dapur', async () => {
    const storage = new Map<string, string>();
    const movedMenus = reorderMenuItems(menus, 'es-teh', 0);

    expect(movedMenus.map((menu) => menu.id)).toEqual(['es-teh', 'mie', 'bakso']);

    await Promise.resolve(
      storage.set(WARUNG_STATE_STORAGE_KEY, JSON.stringify(stateWithMenus(movedMenus))),
    );

    const restoredState = await hydrateWarungState(
      storage.get(WARUNG_STATE_STORAGE_KEY) ?? null,
      async (uri) => uri,
    );
    const dapurCatalog = buildCatalogItems(restoredState.menus, restoredState.consignments);

    expect(restoredState.menus.map((menu) => menu.id)).toEqual(['es-teh', 'mie', 'bakso']);
    expect(dapurCatalog.map((menu) => menu.id)).toEqual(['es-teh', 'mie', 'bakso']);
    expect(dapurCatalog.map((menu) => menu.name)).toEqual(['Es Teh', 'Mie Ayam', 'Bakso']);
  });
});

describe('edit stock menu drag gesture', () => {
  const layouts = {
    mie: { y: 0, height: 68 },
    bakso: { y: 77, height: 68 },
    'es-teh': { y: 154, height: 68 },
  };

  function createGestureFor(menuId: string, menuIndex: number) {
    const activeDrag: ActiveMenuDrag = { current: null };
    const reorderMenus = vi.fn();
    const onDragStart = vi.fn();
    const onDragMove = vi.fn();
    const onDragEnd = vi.fn();
    const onDragCancel = vi.fn();
    const handlers = createMenuDragHandlers({
      menus,
      menuId,
      menuIndex,
      menuLayouts: layouts,
      activeDrag,
      onDragStart,
      onDragMove,
      onDragEnd,
      onDragCancel,
      reorderMenus,
    });

    return { activeDrag, handlers, onDragEnd, onDragMove, reorderMenus };
  }

  it('moves a menu to the intended target index when the gesture is released', () => {
    const { activeDrag, handlers, onDragEnd, onDragMove, reorderMenus } = createGestureFor('mie', 0);

    expect(handlers.onMoveShouldSetPanResponder({}, { dy: 4, dx: 0 })).toBe(false);
    expect(handlers.onMoveShouldSetPanResponder({}, { dy: 20, dx: 30 })).toBe(false);
    expect(handlers.onMoveShouldSetPanResponder({}, { dy: 20, dx: 2 })).toBe(true);

    handlers.onPanResponderGrant();
    handlers.onPanResponderMove({}, { dy: 170, dx: 0 });
    handlers.onPanResponderRelease({}, { dy: 170, dx: 0 });

    expect(onDragMove).toHaveBeenCalledWith(170);
    expect(reorderMenus).toHaveBeenCalledWith('mie', 2);
    expect(onDragEnd).toHaveBeenCalledOnce();
    expect(activeDrag.current).toBeNull();
  });

  it('clamps a release above the first item to the first index', () => {
    const { activeDrag, handlers, reorderMenus } = createGestureFor('mie', 0);

    handlers.onPanResponderGrant();
    handlers.onPanResponderRelease({}, { dy: -500, dx: 0 });

    expect(reorderMenus).toHaveBeenCalledWith('mie', 0);
    expect(activeDrag.current).toBeNull();
  });

  it('clamps a release below the last item to the last index', () => {
    const { activeDrag, handlers, reorderMenus } = createGestureFor('es-teh', 2);

    handlers.onPanResponderGrant();
    handlers.onPanResponderRelease({}, { dy: 500, dx: 0 });

    expect(reorderMenus).toHaveBeenCalledWith('es-teh', 2);
    expect(activeDrag.current).toBeNull();
  });
});