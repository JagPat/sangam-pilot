export const ROOM_ALLOCATION_HEADERS = [
  'Allocation ID','Room ID','Sync revision','Guest 1 ID','Guest 2 ID','Guest 3 ID','Last synced at','Sync status','Sync error',
  'Property','Provisional room ID','Physical room number','Occupancy plan','Guest 1','Guest 2','Guest 3',
  'Single occupancy reason','Sharing confirmed?','Check-in','Check-out','Allocation status','Notes','Action',
] as const;

export type RoomSheetChange = {
  allocationId: string; roomId: string; expectedSyncRevision: number; occupancyPlan: 'single'|'double'|'triple';
  guestIds: string[]; singleReason: string|null; checkIn: string|null; checkOut: string|null;
  status: 'held'|'confirmed'|'cancelled'; notes: string|null; action: 'update'|'cancel';
};
export type NormalizedRoomSheetRow = { ignored?: boolean; valid: boolean; codes: string[]; change?: RoomSheetChange };
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE=/^\d{4}-\d{2}-\d{2}$/;
const clean=(v:unknown)=>String(v??'').trim();

export function normalizeRoomSheetRow(row: Record<string, unknown>): NormalizedRoomSheetRow {
  if (Object.values(row).every((v)=>clean(v)==='')) return { ignored:true, valid:true, codes:[] };
  const codes:string[]=[]; const allocationId=clean(row['Allocation ID']); const roomId=clean(row['Room ID']);
  const revision=Number(clean(row['Sync revision']));
  if (!UUID.test(allocationId)||!UUID.test(roomId)||!Number.isSafeInteger(revision)||revision<1) codes.push('update_only');
  const guestIds=['Guest 1 ID','Guest 2 ID','Guest 3 ID'].map((h)=>clean(row[h])).filter(Boolean);
  if (guestIds.some((id)=>!UUID.test(id))) codes.push('unknown_guest');
  if (new Set(guestIds).size!==guestIds.length) codes.push('duplicate_guest');
  const planRaw=clean(row['Occupancy plan']).toLowerCase();
  const occupancyPlan=(['single','double','triple'].includes(planRaw)?planRaw:'double') as RoomSheetChange['occupancyPlan'];
  if (planRaw && !['single','double','triple'].includes(planRaw)) codes.push('invalid_occupancy');
  const checkIn=clean(row['Check-in'])||null; const checkOut=clean(row['Check-out'])||null;
  if ((checkIn&&!ISO_DATE.test(checkIn))||(checkOut&&!ISO_DATE.test(checkOut))) codes.push('invalid_date');
  if (checkIn&&checkOut&&ISO_DATE.test(checkIn)&&ISO_DATE.test(checkOut)&&checkOut<checkIn) codes.push('invalid_date_order');
  const statusRaw=clean(row['Allocation status']).toLowerCase();
  const status=(['confirmed','cancelled'].includes(statusRaw)?statusRaw:'held') as RoomSheetChange['status'];
  const action=clean(row.Action).toLowerCase()==='cancel'?'cancel':'update';
  return { valid:codes.length===0, codes, ...(codes.length?{}:{ change:{ allocationId,roomId,expectedSyncRevision:revision,
    occupancyPlan,guestIds,singleReason:clean(row['Single occupancy reason'])||null,checkIn,checkOut,status,
    notes:clean(row.Notes)||null,action } }) };
}
