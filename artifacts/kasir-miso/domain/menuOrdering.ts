import type { MenuItem, WarungState } from '@/context/WarungContext';

export const WARUNG_STATE_STORAGE_KEY = 'warung-state-v2';

export function createDefaultWarungState(): WarungState {
  return {
    menus: [],
    activeOrders: [],
    kitchenOrders: [],
    inventory: [],
    consignments: [],
    expenses: [],
    sales: [],
    savingsRules: [],
    savingsEntries: [],
    qrisImageUri: undefined,
  };
}

export function reorderMenuItems(menus: MenuItem[], id: string, toIndex: number) {
  const fromIndex = menus.findIndex((item) => item.id === id);
  if (fromIndex < 0 || toIndex < 0 || toIndex >= menus.length || fromIndex === toIndex) return menus;

  const reordered = [...menus];
  const [moved] = reordered.splice(fromIndex, 1);
  if (!moved) return menus;
  reordered.splice(toIndex, 0, moved);
  return reordered;
}

type PersistImageUri = (uri?: string) => Promise<string | undefined>;

export async function hydrateWarungState(raw: string | null, persistImageUri: PersistImageUri): Promise<WarungState> {
  if (!raw) return createDefaultWarungState();

  try {
    const saved = JSON.parse(raw) as Partial<WarungState>;
    const savedKitchenOrders = Array.isArray(saved.kitchenOrders) ? saved.kitchenOrders : [];
    const savedActiveOrders = Array.isArray(saved.activeOrders) ? saved.activeOrders : [];
    const normalizedActiveOrders = savedActiveOrders.map((order) => ({
      ...order,
      cooked: typeof order.cooked === 'boolean'
        ? order.cooked
        : !savedKitchenOrders.some((kitchenOrder) => kitchenOrder.id === order.id),
    }));
    const menus = Array.isArray(saved.menus)
      ? await Promise.all(saved.menus.map(async (menu) => ({
        ...menu,
        imageUri: await persistImageUri(menu.imageUri),
      })))
      : [];
    const consignments = Array.isArray(saved.consignments)
      ? await Promise.all(saved.consignments.map(async (item) => ({
        ...item,
        imageUri: await persistImageUri(item.imageUri),
      })))
      : [];
    const qrisImageUri = await persistImageUri(saved.qrisImageUri);

    return {
      ...createDefaultWarungState(),
      ...saved,
      menus,
      activeOrders: normalizedActiveOrders,
      kitchenOrders: savedKitchenOrders,
      inventory: Array.isArray(saved.inventory) ? saved.inventory : [],
      consignments: consignments.map((item) => ({
        ...item,
        packSize: Number(item.packSize) > 0 ? Number(item.packSize) : 1,
      })),
      expenses: Array.isArray(saved.expenses) ? saved.expenses : [],
      sales: Array.isArray(saved.sales) ? saved.sales : [],
      savingsRules: Array.isArray(saved.savingsRules) ? saved.savingsRules : [],
      savingsEntries: Array.isArray(saved.savingsEntries) ? saved.savingsEntries : [],
      qrisImageUri,
    };
  } catch {
    return createDefaultWarungState();
  }
}