export type OccupancyPlan = 'single' | 'double' | 'triple';

export function displayRoomIdentity(room: { provisionalCode: string; physicalRoomNumber: string | null }): { primary: string; planningCode: string | null } {
  const physical = room.physicalRoomNumber?.trim();
  return physical ? { primary: physical, planningCode: room.provisionalCode } : { primary: room.provisionalCode, planningCode: null };
}

export function occupancyLabel(plan: OccupancyPlan): string {
  if (plan === 'single') return 'Single · exception';
  if (plan === 'triple') return 'Triple · explicitly approved';
  return 'Double';
}

const WARNING_COPY: Record<string, { kind: 'blocking' | 'advisory'; text: string }> = {
  single_reason_missing: { kind: 'blocking', text: 'Single occupancy needs a reason' },
  sharing_unconfirmed: { kind: 'blocking', text: 'Confirm the exact sharing group' },
  occupancy_mismatch: { kind: 'blocking', text: 'Occupant count does not match the room plan' },
  physical_number_missing: { kind: 'advisory', text: 'Physical room number pending' },
  property_tbd: { kind: 'advisory', text: 'Exact outside property pending' },
};

export function classifyRoomWarnings(codes: string[]): { blocking: string[]; advisory: string[] } {
  const result = { blocking: [] as string[], advisory: [] as string[] };
  for (const code of codes) {
    const warning = WARNING_COPY[code];
    if (warning && !result[warning.kind].includes(warning.text)) result[warning.kind].push(warning.text);
  }
  const priority = ['Single occupancy needs a reason', 'Occupant count does not match the room plan', 'Confirm the exact sharing group'];
  result.blocking.sort((a, b) => priority.indexOf(a) - priority.indexOf(b));
  return result;
}

export function staleRoomMessage(): string {
  return 'This room plan changed since you opened it. Refresh and review the latest sharing group before saving.';
}
