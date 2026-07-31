import { validateOfficialCostText } from './costPrivacy';
import type { AppSupabaseClient } from '../supabase/clients';

export const COST_IMPORT_COLUMNS=[
  'source_line_id','title','subtotal','currency','tax_rate','cost_centre','match_item','scope_included','scope_excluded',
] as const;
export const MAX_COST_IMPORT_BYTES=1_000_000;
export const MAX_COST_IMPORT_ROWS=500;

export type ParsedCostImportRow={
  sourceLineId:string;
  title:string;
  subtotal:number;
  currency:'INR'|'USD';
  taxRate:number;
  centreName:string;
  matchItemTitle:string;
  scopeIncluded:string;
  scopeExcluded:string;
};

export type CostImportParseResult={rows:ParsedCostImportRow[];errors:string[]};
export type PreparedCostImportRow={
  source_line_id:string;title:string;subtotal:number;currency_code:'INR'|'USD';tax_rate:number;
  scope_included:string|null;scope_excluded:string|null;resolution:'matched'|'create'|'unresolved';
  cost_centre_id:string|null;matched_cost_item_id:string|null;
};
export type CostImportLine={
  id:string;sourceLineId:string;sourceOrder:number;title:string;centreId:string|null;matchedItemId:string|null;
  subtotal:number;taxRate:number;currency:string;scopeIncluded:string|null;scopeExcluded:string|null;
  resolution:string;matchConfirmed:boolean;committedItemId:string|null;committedEstimateId:string|null;
};
export type CostImportBatch={
  id:string;weddingId:string;importKey:string;sourceName:string;state:string;createdAt:string;committedAt:string|null;
  lines:CostImportLine[];
};

function parseCsvRecords(text:string):{records:string[][];error:string|null}{
  const records:string[][]=[];
  let record:string[]=[];
  let field='';
  let quoted=false;
  for(let index=0;index<text.length;index+=1){
    const char=text[index];
    if(quoted){
      if(char==='"'&&text[index+1]==='"'){field+='"';index+=1;}
      else if(char==='"') quoted=false;
      else field+=char;
      continue;
    }
    if(char==='"'&&field===''){quoted=true;continue;}
    if(char===','){record.push(field);field='';continue;}
    if(char==='\n'){
      record.push(field);
      if(record.some((value)=>value.trim()!=='')) records.push(record);
      record=[];field='';
      continue;
    }
    if(char!=='\r') field+=char;
  }
  if(quoted) return {records,error:'CSV contains an unclosed quoted field.'};
  record.push(field);
  if(record.some((value)=>value.trim()!=='')) records.push(record);
  return {records,error:null};
}

export function parseCostImportCsv(text:string):CostImportParseResult{
  if(new TextEncoder().encode(text).byteLength>MAX_COST_IMPORT_BYTES){
    return {rows:[],errors:['CSV must be 1 MB or smaller.']};
  }
  const parsed=parseCsvRecords(text.trim());
  if(parsed.error) return {rows:[],errors:[parsed.error]};
  const [header,...records]=parsed.records;
  const expected=COST_IMPORT_COLUMNS.join(',');
  if(!header||header.map((value)=>value.trim().toLowerCase()).join(',')!==expected){
    return {rows:[],errors:[`CSV header must be: ${expected}`]};
  }
  if(records.length>MAX_COST_IMPORT_ROWS){
    return {rows:[],errors:[`CSV may contain at most ${MAX_COST_IMPORT_ROWS} data rows.`]};
  }

  const rows:ParsedCostImportRow[]=[];
  const errors:string[]=[];
  const seen=new Set<string>();
  records.forEach((record,index)=>{
    const rowNumber=index+2;
    if(record.length!==COST_IMPORT_COLUMNS.length){
      errors.push(`Row ${rowNumber}: expected ${COST_IMPORT_COLUMNS.length} columns.`);
      return;
    }
    const [sourceLineId,title,subtotalText,currencyText,taxText,centreName,matchItemTitle,scopeIncluded,scopeExcluded]=record.map((value)=>value.trim());
    const subtotal=Number(subtotalText);
    const taxRate=Number(taxText||'0');
    const currency=currencyText.toUpperCase();
    if(!sourceLineId) errors.push(`Row ${rowNumber}: source_line_id is required.`);
    else if(seen.has(sourceLineId)) errors.push(`Row ${rowNumber}: source_line_id "${sourceLineId}" is duplicated.`);
    else seen.add(sourceLineId);
    if(!title) errors.push(`Row ${rowNumber}: title is required.`);
    if(!Number.isFinite(subtotal)||subtotal<0) errors.push(`Row ${rowNumber}: subtotal must be zero or more.`);
    if(currency!=='INR'&&currency!=='USD') errors.push(`Row ${rowNumber}: currency must be INR or USD.`);
    if(!Number.isFinite(taxRate)||taxRate<0||taxRate>100) errors.push(`Row ${rowNumber}: tax_rate must be between 0 and 100.`);
    const privacy=[title,centreName,matchItemTitle,scopeIncluded,scopeExcluded]
      .map((value)=>validateOfficialCostText(value)).find((result)=>!result.ok);
    if(privacy&&!errors.some((error)=>error.startsWith(`Row ${rowNumber}: Do not enter`))){
      errors.push(`Row ${rowNumber}: ${privacy.reason}`);
    }
    if(errors.some((error)=>error.startsWith(`Row ${rowNumber}:`))) return;
    rows.push({
      sourceLineId,title,subtotal,currency:currency as 'INR'|'USD',taxRate,centreName,matchItemTitle,
      scopeIncluded,scopeExcluded,
    });
  });
  return {rows,errors};
}

const normalized=(value:string)=>value.trim().toLocaleLowerCase('en');

export function prepareCostImportRows(
  rows:ParsedCostImportRow[],
  centres:{id:string;name:string}[],
  items:{id:string;centreId:string;title:string}[],
):PreparedCostImportRow[]{
  return rows.map((row)=>{
    const centre=centres.find((candidate)=>normalized(candidate.name)===normalized(row.centreName));
    const requestedItem=row.matchItemTitle&&centre
      ?items.find((candidate)=>candidate.centreId===centre.id&&normalized(candidate.title)===normalized(row.matchItemTitle))
      :undefined;
    const resolution:PreparedCostImportRow['resolution']=requestedItem?'matched'
      :centre&&!row.matchItemTitle?'create':'unresolved';
    return {
      source_line_id:row.sourceLineId,title:row.title,subtotal:row.subtotal,currency_code:row.currency,tax_rate:row.taxRate,
      scope_included:row.scopeIncluded||null,scope_excluded:row.scopeExcluded||null,resolution,
      cost_centre_id:resolution==='unresolved'?null:centre?.id??null,
      matched_cost_item_id:requestedItem?.id??null,
    };
  });
}

export async function getCostImportBatches(db:AppSupabaseClient,weddingIds:string[]):Promise<CostImportBatch[]>{
  if(!weddingIds.length) return [];
  const app=db.schema('app');
  const batches=await app.from('cost_import_batch')
    .select('id,wedding_id,import_key,source_name,state,created_at,committed_at')
    .in('wedding_id',weddingIds).order('created_at',{ascending:false}).limit(20);
  if(batches.error) throw batches.error;
  const ids=(batches.data??[]).map((batch)=>batch.id);
  const lines=ids.length?await app.from('cost_import_line')
    .select('id,wedding_id,batch_id,source_line_id,source_order,title,cost_centre_id,matched_cost_item_id,subtotal,tax_rate,currency_code,scope_included,scope_excluded,resolution,match_confirmed,committed_item_id,committed_estimate_id')
    .in('batch_id',ids).order('source_order',{ascending:true}):{data:[],error:null};
  if(lines.error) throw lines.error;
  return (batches.data??[]).map((batch)=>({
    id:batch.id,weddingId:batch.wedding_id,importKey:batch.import_key,sourceName:batch.source_name,state:batch.state,
    createdAt:batch.created_at,committedAt:batch.committed_at,
    lines:(lines.data??[]).filter((line)=>line.batch_id===batch.id).map((line)=>({
      id:line.id,sourceLineId:line.source_line_id,sourceOrder:line.source_order,title:line.title,
      centreId:line.cost_centre_id,matchedItemId:line.matched_cost_item_id,subtotal:Number(line.subtotal),
      taxRate:Number(line.tax_rate),currency:line.currency_code,scopeIncluded:line.scope_included,
      scopeExcluded:line.scope_excluded,resolution:line.resolution,matchConfirmed:line.match_confirmed,
      committedItemId:line.committed_item_id,committedEstimateId:line.committed_estimate_id,
    })),
  }));
}
