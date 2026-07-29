type DestinationSection = { href: string };

export function safeInternalPath(value: string | null | undefined, fallback = '/schedule'): string {
  return value?.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\') ? value : fallback;
}

// Carry a requested destination through the intermediate OTP states without ever reflecting an external
// URL. An omitted destination stays omitted so the usual role-aware post-auth landing still applies.
export function withSafeNext(path: string, nextParam: string | null | undefined, fallback = '/schedule'): string {
  if (!nextParam) return path;
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}next=${encodeURIComponent(safeInternalPath(nextParam, fallback))}`;
}

export function postAuthDestination(
  nextParam: string | null | undefined,
  sections: readonly DestinationSection[],
  canCreateWedding = false,
): string {
  const roleDefault = sections[0]?.href ?? (canCreateWedding ? '/host/setup' : '/schedule');
  return nextParam == null ? roleDefault : safeInternalPath(nextParam, roleDefault);
}
