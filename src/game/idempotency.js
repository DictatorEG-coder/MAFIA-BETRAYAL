export async function runOnce(storage, key, operation) {
 if (typeof key !== "string" || key.length < 8 || key.length > 128) throw new TypeError("Invalid idempotency key");
 const recordKey = "idempotency:" + key;
 const previous = await storage.get(recordKey);
 if (previous !== undefined) return { replayed: true, value: previous };
 const value = await operation();
 await storage.put(recordKey, value);
 return { replayed: false, value };
}