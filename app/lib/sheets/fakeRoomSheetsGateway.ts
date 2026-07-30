import { ROOM_SHEET_TABS,type RoomSheetsGateway } from './roomSheetsGateway';
export class FakeRoomSheetsGateway implements RoomSheetsGateway {
 private rows=new Map<string,string[][]>();
 constructor(private sheets:string[]=[],private timeZone='America/Los_Angeles'){}
 async getWorkbook(){return {title:'Test workbook',timeZone:this.timeZone,sheets:[...this.sheets]};}
 async ensureOperationalTabs(timeZone:string){this.timeZone=timeZone; for(const tab of ROOM_SHEET_TABS) if(!this.sheets.includes(tab)) this.sheets.push(tab);}
 async readRows(tab:string){return this.rows.get(tab)?.map((r)=>[...r])??[];}
 async replaceRows(tab:string,rows:string[][]){if(!this.sheets.includes(tab)) this.sheets.push(tab);this.rows.set(tab,rows.map((r)=>[...r]));}
}
