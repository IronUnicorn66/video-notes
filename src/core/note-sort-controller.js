import { normalizeNoteSortOrder } from "./note-sort-order.js";

export function createNoteSortController({
  initialOrder,
  onOrderChange,
  persistOrder,
  onPersistError = () => {},
}) {
  let order = normalizeNoteSortOrder(initialOrder);
  let hasNewerPreference = false;

  function apply(value) {
    const nextOrder = normalizeNoteSortOrder(value);
    if (nextOrder === order) return false;
    order = nextOrder;
    onOrderChange(order);
    return true;
  }

  return {
    get order() {
      return order;
    },
    sync(value, { initial = false } = {}) {
      if (initial && hasNewerPreference) return false;
      if (!initial) hasNewerPreference = true;
      return apply(value);
    },
    async select(value) {
      hasNewerPreference = true;
      if (!apply(value)) return false;
      try {
        await persistOrder(order);
      } catch (error) {
        onPersistError(error);
      }
      return true;
    },
  };
}
