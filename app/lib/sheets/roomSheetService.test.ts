import { describe,expect,it } from 'vitest';
import { FakeRoomSheetsGateway } from './fakeRoomSheetsGateway';
import { exportRoomWorkbook, readProposedRoomChanges } from './roomSheetService';
import { ROOM_ALLOCATION_HEADERS } from './roomSheetContract';

describe('room sheet service',()=>{
 it('creates only operational tabs and preserves guest guidance',async()=>{
  const gateway=new FakeRoomSheetsGateway(['Guests','How to fill this in']);
  await exportRoomWorkbook(gateway,{ allocations:[{ allocationId:'a',roomId:'r',revision:2,property:'Suryagarh',provisional:'SUR-001',physical:null,
   plan:'double',guestIds:['g1','g2'],guestNames:['One','Two'],reason:null,confirmed:false,checkIn:null,checkOut:null,status:'held',notes:null }],
   summary:[['Suryagarh','Double','0','1']],unallocated:[['g3','Three']],conflicts:[] });
  expect((await gateway.getWorkbook()).sheets).toEqual(['Guests','How to fill this in','Room Allocation','Room Summary','Unallocated Guests','Sync Conflicts']);
  expect((await gateway.readRows('Guests' as never))).toEqual([]);
  expect((await gateway.readRows('Room Allocation'))[0]).toEqual([...ROOM_ALLOCATION_HEADERS]);
 });
 it('normalizes changed rows without mutating operational state',async()=>{
  const gateway=new FakeRoomSheetsGateway();
  await gateway.replaceRows('Room Allocation',[ [...ROOM_ALLOCATION_HEADERS],
   ['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','1','33333333-3333-4333-8333-333333333333','','','','','','','','','Single','','','','Privacy','','','','Held','',''] ]);
  const rows=await readProposedRoomChanges(gateway);
  expect(rows).toHaveLength(1); expect(rows[0].normalized.valid).toBe(true);
 });
});
