type DestinationSection = { href: string };

export function safeInternalPath(value: string | null | undefined, fallback = '/schedule'): string {
  return value?.startsWith('/') && !value.startsWith('//') ? value : fallback;
}

export function postAuthDestination(
  nextParam: string | null | undefined,
  sections: readonly DestinationSection[],
  canCreateWedding = false,
): string {
  const roleDefault = sections[0]?.href ?? (canCreateWedding ? '/host/setup' : '/schedule');
  return nextParam == null ? roleDefault : safeInternalPath(nextParam, roleDefault);
}
