export function travelInputValue(wallLocal: string | null, instant: string | null): string {
  return (wallLocal ?? instant)?.slice(0, 16) ?? '';
}
