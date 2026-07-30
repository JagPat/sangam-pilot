import { createSign } from 'node:crypto';
import { ROOM_SHEET_TABS,type RoomSheetsGateway } from './roomSheetsGateway';
type Credentials={client_email:string;private_key:string;token_uri?:string};
type SheetMetadata={properties:{title:string;timeZone:string};sheets:Array<{properties:{sheetId:number;title:string};protectedRanges?:Array<{protectedRangeId:number;description?:string;warningOnly?:boolean}>}>};
const PROTECTION_DESCRIPTION='Sangam identity and room master fields — edit in Sangam';
const b64=(value:string|Buffer)=>Buffer.from(value).toString('base64url');
let cached:{token:string;expires:number}|null=null;
async function accessToken(c:Credentials){
 if(cached&&cached.expires>Date.now()+60_000)return cached.token;
 const now=Math.floor(Date.now()/1000);const header=b64(JSON.stringify({alg:'RS256',typ:'JWT'}));
 const payload=b64(JSON.stringify({iss:c.client_email,scope:'https://www.googleapis.com/auth/spreadsheets',aud:c.token_uri??'https://oauth2.googleapis.com/token',iat:now,exp:now+3600}));
 const signer=createSign('RSA-SHA256');signer.update(`${header}.${payload}`);const assertion=`${header}.${payload}.${signer.sign(c.private_key,'base64url')}`;
 const response=await fetch(c.token_uri??'https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
  body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion})});
 if(!response.ok)throw new Error(`Google authentication failed (${response.status})`);const data=await response.json() as {access_token:string;expires_in:number};
 cached={token:data.access_token,expires:Date.now()+data.expires_in*1000};return cached.token;
}
export class GoogleRoomSheetsGateway implements RoomSheetsGateway{
 constructor(private spreadsheetId:string,private credentials:Credentials){}
 private async request(path:string,init:RequestInit={}){const token=await accessToken(this.credentials);const response=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}${path}`,
  {...init,headers:{authorization:`Bearer ${token}`,'content-type':'application/json',...(init.headers??{})}});if(!response.ok)throw new Error(`Google Sheets request failed (${response.status})`);return response.status===204?{}:response.json();}
 private async metadata(){return this.request('?fields=properties(title,timeZone),sheets(properties(sheetId,title),protectedRanges(protectedRangeId,description,warningOnly))') as Promise<SheetMetadata>;}
 async getWorkbook(){const data=await this.metadata();
  return {title:data.properties.title,timeZone:data.properties.timeZone,sheets:data.sheets.map((s)=>s.properties.title)};}
 async ensureOperationalTabs(timeZone:string){const initial=await this.metadata();const missing=ROOM_SHEET_TABS.filter((t)=>!initial.sheets.some((s)=>s.properties.title===t));
  const requests:unknown[]=[{updateSpreadsheetProperties:{properties:{timeZone},fields:'timeZone'}},...missing.map((title)=>({addSheet:{properties:{title,gridProperties:{frozenRowCount:1}}}}))];
  await this.request(':batchUpdate',{method:'POST',body:JSON.stringify({requests})});
  const current=await this.metadata();const allocation=current.sheets.find((s)=>s.properties.title==='Room Allocation');
  if(!allocation)throw new Error('Room Allocation tab could not be created');
  const existing=allocation.protectedRanges?.find((p)=>p.description===PROTECTION_DESCRIPTION);
  const protection={range:{sheetId:allocation.properties.sheetId,startRowIndex:0,endRowIndex:1000,startColumnIndex:0,endColumnIndex:12},description:PROTECTION_DESCRIPTION,warningOnly:false,editors:{users:[this.credentials.client_email]}};
  const harden=existing
   ? [{updateProtectedRange:{protectedRange:{protectedRangeId:existing.protectedRangeId,...protection},fields:'range,description,warningOnly,editors'}}]
   : [{addProtectedRange:{protectedRange:protection}}];
  await this.request(':batchUpdate',{method:'POST',body:JSON.stringify({requests:[...harden,{updateDimensionProperties:{range:{sheetId:allocation.properties.sheetId,dimension:'COLUMNS',startIndex:0,endIndex:9},properties:{hiddenByUser:true},fields:'hiddenByUser'}}]})});
 }
 async readRows(tab:typeof ROOM_SHEET_TABS[number]){const range=encodeURIComponent(`'${tab}'!A1:Z1000`);const data=await this.request(`/values/${range}?majorDimension=ROWS`) as {values?:string[][]};return data.values??[];}
 async replaceRows(tab:typeof ROOM_SHEET_TABS[number],rows:string[][]){const range=encodeURIComponent(`'${tab}'!A:Z`);await this.request(`/values/${range}:clear`,{method:'POST',body:'{}'});
  await this.request(`/values/${range}?valueInputOption=RAW`,{method:'PUT',body:JSON.stringify({range:`'${tab}'!A1`,majorDimension:'ROWS',values:rows})});}
}
export function roomSheetsGatewayFromEnv(spreadsheetId?:string){const id=spreadsheetId??process.env.ROOM_SHEET_SPREADSHEET_ID;const raw=process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON;
 if(!id||!raw)throw new Error('Room Sheet synchronization is not configured');return new GoogleRoomSheetsGateway(id,JSON.parse(raw) as Credentials);}
