import { normalizeNoteSortOrder } from "./note-sort-order.js";

export function createNoteSortController({
  initialOrder,
  onOrderChange,
  persistOrder,
  onPersistError = () => {},
}) {
  let order = normalizeNoteSortOrder(initialOrder);

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
    sync(value) {
      return apply(value);
    },
    async select(value) {
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
