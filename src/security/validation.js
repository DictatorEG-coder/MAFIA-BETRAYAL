export function isTelegramId(value) {
  return typeof value === "string" && /^[1-9][0-9]{0,19}$/.test(value);
}
export function isValidRoomId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}
