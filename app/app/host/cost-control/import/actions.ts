'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { MAX_COST_IMPORT_BYTES,parseCostImportCsv,prepareCostImportRows } from '@/lib/data/cost-import';
import { serverClientRW } from '@/lib/supabase/serverClient';

const text=(fd:FormData,key:string)=>String(fd.get(key)??'').trim();
const fail=(code:string):never=>redirect(`/host/cost-control/import?err=${encodeURIComponent(code)}`);
const done=(code:string,batch?:string|null):never=>{
  revalidatePath('/host/cost-control');
  revalidatePath('/host/cost-control/import');
  redirect(`/host/cost-control/import?ok=${encodeURIComponent(code)}${batch?`&batch=${encodeURIComponent(batch)}`:''}`);
};

export async function stageCostImport(fd:FormData){
  const weddingId=text(fd,'weddingId');
  const file=fd.get('file');
  const pasted=text(fd,'csv');
  if(file instanceof File&&file.size>MAX_COST_IMPORT_BYTES) fail('csv');
  const csv=file instanceof File&&file.size?await file.text():pasted;
  const parsed=parseCostImportCsv(csv);
  if(!weddingId||parsed.errors.length||!parsed.rows.length){
    console.warn('[sangam cost-import] CSV rejected',{weddingId:Boolean(weddingId),errors:parsed.errors.length});
    fail('csv');
  }
  const db=await serverClientRW();
  const app=db.schema('app');
  const [centres,items]=await Promise.all([
    app.from('cost_centre').select('id,name').eq('wedding_id',weddingId),
    app.from('cost_item').select('id,cost_centre_id,title').eq('wedding_id',weddingId),
  ]);
  if(centres.error||items.error) fail('catalogue');
  const lines=prepareCostImportRows(parsed.rows,centres.data??[],(items.data??[]).map((item)=>({
    id:item.id,centreId:item.cost_centre_id,title:item.title,
  })));
  const result=await app.rpc('stage_cost_import',{
    p_wedding:weddingId,p_import_key:text(fd,'importKey'),p_source_name:text(fd,'sourceName'),p_lines:lines,
  });
  if(result.error){
    console.error('[sangam cost-import] stage',result.error);
    fail('stage');
  }
  done('staged',result.data);
}

export async function resolveCostImportLine(fd:FormData){
  const weddingId=text(fd,'weddingId');
  const target=text(fd,'target');
  const [kind,id]=target.split(':',2);
  if(!weddingId||!id||!['create','match'].includes(kind)) fail('target');
  const app=(await serverClientRW()).schema('app');
  let centreId=id;
  let matchedItemId:string|null=null;
  if(kind==='match'){
    const item=await app.from('cost_item').select('cost_centre_id').eq('wedding_id',weddingId).eq('id',id).maybeSingle();
    if(item.error||!item.data) fail('target');
    const selectedItem=item.data!;
    centreId=selectedItem.cost_centre_id;
    matchedItemId=id;
  }
  const result=await app.rpc('resolve_cost_import_line',{
    p_wedding:weddingId,p_line:text(fd,'lineId'),p_centre:centreId,p_matched_item:matchedItemId,
  });
  if(result.error){console.error('[sangam cost-import] resolve',result.error);fail('resolve');}
  done('resolved',text(fd,'batchId'));
}

export async function confirmCostImportMatches(fd:FormData){
  const lineIds=fd.getAll('lineId').map(String).filter(Boolean);
  if(!lineIds.length) fail('matches');
  const app=(await serverClientRW()).schema('app');
  const result=await app.rpc('confirm_cost_import_matches',{
    p_wedding:text(fd,'weddingId'),p_batch:text(fd,'batchId'),p_line_ids:lineIds,
  });
  if(result.error){console.error('[sangam cost-import] confirm',result.error);fail('matches');}
  done('confirmed',text(fd,'batchId'));
}

export async function commitCostImport(fd:FormData){
  const app=(await serverClientRW()).schema('app');
  const result=await app.rpc('commit_cost_import',{p_wedding:text(fd,'weddingId'),p_batch:text(fd,'batchId')});
  if(result.error){console.error('[sangam cost-import] commit',result.error);fail('commit');}
  done('committed',text(fd,'batchId'));
}
