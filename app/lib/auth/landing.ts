type DestinationSection = { href: string };

const INTERNAL_ORIGIN = 'https://sangam.invalid';

export function safeInternalPath(value: string | null | undefined, fallback = '/schedule'): string {
  if (!value?.startsWith('/') || /[\\\u0000-\u001f\u007f]/.test(value)) return fallback;
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return fallback;
  }
  if (/[\\\u0000-\u001f\u007f]/.test(decoded) || decoded.startsWith('//')) return fallback;
  try {
    const parsed = new URL(value, INTERNAL_ORIGIN);
    if (parsed.origin !== INTERNAL_ORIGIN || parsed.pathname.startsWith('//')) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
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
