/**
 * Allowlist check for Discord admin slash commands (009.1E).
 * User IDs only — roles are never consulted.
 */
export function isAllowlistedAdmin(
  userId: string,
  adminUserIds: readonly string[],
): boolean {
  if (typeof userId !== "string" || userId.trim() === "") {
    return false;
  }
  return adminUserIds.includes(userId);
}
