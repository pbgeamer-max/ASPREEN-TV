/**
 * Recursively removes undefined fields from an object to ensure compatibility
 * with Firestore documents without runtime errors.
 */
export function cleanUndefined<T extends Record<string, any>>(obj: T): T {
  const result: any = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      if (value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
        result[key] = cleanUndefined(value);
      } else {
        result[key] = value;
      }
    }
  }
  return result;
}
