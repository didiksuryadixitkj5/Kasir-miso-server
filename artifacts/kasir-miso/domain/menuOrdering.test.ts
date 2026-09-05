import { describe, expect, it } from 'vitest';
import type { ConsignmentItem, MenuItem, WarungState } from '@/context/WarungContext';
import { buildCatalogItems } from './menuCatalog';
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