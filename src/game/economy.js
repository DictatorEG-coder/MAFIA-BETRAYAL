export const STARTING_BALANCE = 500;
export const SHOP = Object.freeze({
  armor: 150, supplies: 50, clue: 100, cancel_event: 200, rescue: 250
});

export function purchase(balance, item, quantity = 1) {
  if (!Number.isSafeInteger(balance) || balance < 0) throw new RangeError("Invalid balance");
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 5) throw new RangeError("Invalid quantity");
  const price = SHOP[item];
  if (!price) throw new Error("Unknown item");
  const total = price * quantity;
  if (balance < total) return { ok: false, balance, reason: "insufficient_funds" };
  return { ok: true, balance: balance - total, item, quantity, total };
}
