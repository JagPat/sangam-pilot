import { ROOM_ALLOCATION_HEADERS,normalizeRoomSheetRow } from './roomSheetContract';
import type { RoomSheetsGateway } from './roomSheetsGateway';

export type RoomWorkbookExport={allocations:Array<{allocationId:string;roomId:string;revision:number;property:string;provisional:string;physical:string|null;
 plan:string;guestIds:string[];guestNames:string[];reason:string|null;confirmed:boolean;checkIn:string|null;checkOut:string|null;status:string;notes:string|null}>;
 summary:string[][];unallocated:string[][];conflicts:string[][]};
const title=(s:string)=>s ? s[0].toUpperCase()+s.slice(1) : '';
export async function exportRoomWorkbook(gateway:RoomSheetsGateway,data:RoomWorkbookExport):Promise<void>{
 await gateway.ensureOperationalTabs('Asia/Kolkata'); const synced=new Date().toISOString();
 const allocationRows=data.allocations.map((a)=>[a.allocationId,a.roomId,String(a.revision),a.guestIds[0]??'',a.guestIds[1]??'',a.guestIds[2]??'',synced,'Clean','',
  a.property,a.provisional,a.physical??'',title(a.plan),a.guestNames[0]??'',a.guestNames[1]??'',a.guestNames[2]??'',a.reason??'',a.confirmed?'Yes':'No',
  a.checkIn??'',a.checkOut??'',title(a.status),a.notes??'','']);
 await gateway.replaceRows('Room Allocation',[[...ROOM_ALLOCATION_HEADERS],...allocationRows]);
 await gateway.replaceRows('Room Summary',[['Property','Occupancy','Confirmed rooms','Draft rooms'],...data.summary]);
 await gateway.replaceRows('Unallocated Guests',[['Guest ID','Guest'],...data.unallocated]);
 await gateway.replaceRows('Sync Conflicts',[['Allocation ID','Reason','Action required'],...data.conflicts]);
}
export async function readProposedRoomChanges(gateway:RoomSheetsGateway){
 const rows=await gateway.readRows('Room Allocation'); if(rows.length<2)return [];
 const headers=rows[0]; return rows.slice(1).map((values,index)=>{const record:Record<string,string>={};headers.forEach((h,i)=>record[h]=values[i]??'');
  return {rowNumber:index+2,record,normalized:normalizeRoomSheetRow(record)};}).filter((x)=>!x.normalized.ignored);
}
