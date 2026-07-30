import { describe, expect, it } from 'vitest';
import { ROOM_ALLOCATION_HEADERS, normalizeRoomSheetRow } from './roomSheetContract';

const ids = {
  allocation: '11111111-1111-4111-8111-111111111111', room: '22222222-2222-4222-8222-222222222222',
  g1: '33333333-3333-4333-8333-333333333333', g2: '44444444-4444-4444-8444-444444444444',
};

describe('room sheet contract', () => {
  it('keeps protected IDs separate from display names', () => {
    const row = Object.fromEntries(ROOM_ALLOCATION_HEADERS.map((h) => [h, ''])) as Record<string, string>;
    Object.assign(row, { 'Allocation ID': ids.allocation, 'Room ID': ids.room, 'Sync revision': '7', 'Guest 1 ID': ids.g1,
      'Guest 2 ID': ids.g2, 'Occupancy plan': 'Double', 'Guest 1': 'Alex Shah · H-A1', 'Guest 2': 'Alex Shah · H-B2',
      'Check-in': '2026-12-01', 'Check-out': '2026-12-04', 'Allocation status': 'Held' });
    expect(normalizeRoomSheetRow(row)).toMatchObject({ valid: true, change: { allocationId: ids.allocation, roomId: ids.room,
      expectedSyncRevision: 7, guestIds: [ids.g1, ids.g2], occupancyPlan: 'double' } });
  });

  it('rejects creation, invalid dates, duplicate guests, and delete-by-blank', () => {
    expect(normalizeRoomSheetRow({ 'Allocation ID': '', 'Room ID': ids.room }).codes).toContain('update_only');
    expect(normalizeRoomSheetRow({ 'Allocation ID': ids.allocation, 'Room ID': ids.room, 'Sync revision': '1', 'Occupancy plan': 'Double',
      'Guest 1 ID': ids.g1, 'Guest 2 ID': ids.g1 }).codes).toContain('duplicate_guest');
    expect(normalizeRoomSheetRow({ 'Allocation ID': ids.allocation, 'Room ID': ids.room, 'Sync revision': '1', 'Occupancy plan': 'Double',
      'Check-in': '12/01/2026' }).codes).toContain('invalid_date');
  });

  it('ignores a completely blank row', () => expect(normalizeRoomSheetRow({})).toEqual({ ignored: true, valid: true, codes: [] }));
});
