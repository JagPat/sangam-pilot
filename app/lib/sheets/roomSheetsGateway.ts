export const ROOM_SHEET_TABS=['Room Allocation','Room Summary','Unallocated Guests','Sync Conflicts'] as const;
export interface RoomSheetsGateway {
  getWorkbook():Promise<{ title:string; timeZone:string; sheets:string[] }>;
  ensureOperationalTabs(timeZone:string):Promise<void>;
  readRows(tab:typeof ROOM_SHEET_TABS[number]):Promise<string[][]>;
  replaceRows(tab:typeof ROOM_SHEET_TABS[number],rows:string[][]):Promise<void>;
}
