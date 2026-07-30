import {createSign} from 'node:crypto';
const required=['Room Allocation','Room Summary','Unallocated Guests','Sync Conflicts'];
if(process.env.ROOM_SHEET_LIVE_SMOKE!=='1'){console.log('Room Sheet live smoke skipped (ROOM_SHEET_LIVE_SMOKE is not 1).');process.exit(0);}
const id=process.env.ROOM_SHEET_SPREADSHEET_ID,raw=process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON;
if(!id||!raw)throw new Error('Room Sheet live smoke credentials are missing');const c=JSON.parse(raw);const b64=(v)=>Buffer.from(v).toString('base64url');const now=Math.floor(Date.now()/1000);
const h=b64(JSON.stringify({alg:'RS256',typ:'JWT'})),p=b64(JSON.stringify({iss:c.client_email,scope:'https://www.googleapis.com/auth/spreadsheets.readonly',aud:c.token_uri??'https://oauth2.googleapis.com/token',iat:now,exp:now+600}));
const signer=createSign('RSA-SHA256');signer.update(`${h}.${p}`);const assertion=`${h}.${p}.${signer.sign(c.private_key,'base64url')}`;
const auth=await fetch(c.token_uri??'https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion})});
if(!auth.ok)throw new Error(`Google auth failed (${auth.status})`);const {access_token}=await auth.json();const headers={authorization:`Bearer ${access_token}`};
const metaResponse=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=properties(title,timeZone),sheets(properties(title))`,{headers});if(!metaResponse.ok)throw new Error(`Workbook metadata failed (${metaResponse.status})`);
const meta=await metaResponse.json();const tabs=meta.sheets.map((s)=>s.properties.title);if(!['Asia/Kolkata','Asia/Calcutta'].includes(meta.properties.timeZone))throw new Error(`Workbook timezone is ${meta.properties.timeZone}`);
for(const tab of required)if(!tabs.includes(tab))throw new Error(`Missing workbook tab: ${tab}`);
const guest=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent("'Guests'!A1:I2")}`,{headers});if(!guest.ok)throw new Error('Guest guidance sentinel is unreadable');
const allocation=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent("'Room Allocation'!A1:W1")}`,{headers});const values=(await allocation.json()).values?.[0]??[];
for(const header of ['Allocation ID','Room ID','Sync revision','Guest 1 ID','Sync status','Sync error'])if(!values.includes(header))throw new Error(`Missing protected header: ${header}`);
console.log(`Room Sheet smoke passed for ${meta.properties.title}; ${tabs.length} tabs; guest sheet preserved.`);
