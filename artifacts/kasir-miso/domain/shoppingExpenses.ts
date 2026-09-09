import type { WarungState } from '@/context/WarungContext';

type IdFactory = () => string;

export function addShoppingExpense(
  state: WarungState,
  shoppingItemId: string,
  title: string,
  amount: number,
  makeId: IdFactory,
  date: string,
): WarungState {
  if (!shoppingItemId || !title.trim() || !Number.isFinite(amount) || amount <= 0) return state;
  if (state.expenses.some((expense) => expense.shoppingItemId === shoppingItemId)) return state;

  return {
    ...state,
    expenses: [
      ...state.expenses,
      { id: makeId(), title: title.trim(), amount, date, shoppingItemId },
    ],
  };
}