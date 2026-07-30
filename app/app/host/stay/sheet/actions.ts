'use server';
import {revalidatePath} from 'next/cache';import {redirect} from 'next/navigation';
import {serverClientRW} from '@/lib/supabase/serverClient';import {roomSheetsGatewayFromEnv} from '@/lib/sheets/googleRoomSheetsGateway';
import {exportRoomWorkbook,readProposedRoomChanges} from '@/lib/sheets/roomSheetService';
const t=(fd:FormData,k:string)=>String(fd.get(k)??'').trim();
const finish=(w:string,ok:string)=>{revalidatePath('/host/stay');revalidatePath('/host/stay/sheet');redirect(`/host/stay/sheet?wedding=${encodeURIComponent(w)}&ok=${ok}`);};
const fail=(w:string,code='sync'):never=>redirect(`/host/stay/sheet?wedding=${encodeURIComponent(w)}&err=${code}`);
async function connection(wedding:string){const app=(await serverClientRW()).schema('app');const {data,error}=await app.from('sheet_sync_connection').select('spreadsheet_id').eq('wedding_id',wedding).single();if(error)throw error;return data.spreadsheet_id;}
async function exportAuthoritative(wedding:string,spreadsheet:string){const app=(await serverClientRW()).schema('app');const [plans,summaries,unallocated,conflicts]=await Promise.all([
 app.from('room_plan').select('*').eq('wedding_id',wedding),app.from('room_plan_summary').select('*').eq('wedding_id',wedding),
 app.from('unallocated_stay_guest').select('*').eq('wedding_id',wedding),app.from('sheet_sync_change').select('allocation_id,validation_codes').eq('wedding_id',wedding).eq('validation_status','rejected')]);
 for(const result of [plans,summaries,unallocated,conflicts])if(result.error)throw result.error;
 await exportRoomWorkbook(roomSheetsGatewayFromEnv(spreadsheet),{allocations:(plans.data??[]).map((p)=>({allocationId:p.allocation_id,roomId:p.room_id,revision:p.sync_revision,property:p.property_name,provisional:p.provisional_code,
  physical:p.physical_room_number,plan:p.occupancy_plan,guestIds:p.guest_ids,guestNames:p.guest_names,reason:p.single_occupancy_exception_reason,confirmed:Boolean(p.sharing_confirmed_at),checkIn:p.check_in,checkOut:p.check_out,status:p.status,notes:null})),
  summary:(summaries.data??[]).map((s)=>[s.property_name,s.occupancy_plan,String(s.confirmed_rooms),String(s.draft_rooms)]),
  unallocated:(unallocated.data??[]).map((g)=>[g.guest_id,g.full_name??'']),conflicts:(conflicts.data??[]).map((c)=>[c.allocation_id??'',c.validation_codes.join(', '),'Refresh and reapply'])});
}
export async function configureRoomSheet(fd:FormData){const w=t(fd,'weddingId'),id=t(fd,'spreadsheetId');try{const app=(await serverClientRW()).schema('app');const {error}=await app.rpc('owner_configure_room_sheet',{p_wedding:w,p_spreadsheet_id:id});if(error)throw error;await exportAuthoritative(w,id);}catch(e){console.error('[room sheet] configure',e);fail(w);}finish(w,'configured');}
export async function refreshRoomSheet(fd:FormData){const w=t(fd,'weddingId');try{await exportAuthoritative(w,await connection(w));}catch(e){console.error('[room sheet] refresh',e);fail(w);}finish(w,'refreshed');}
export async function reviewRoomSheetChanges(fd:FormData){const w=t(fd,'weddingId');try{const app=(await serverClientRW()).schema('app');const gateway=roomSheetsGatewayFromEnv(await connection(w));const rows=await readProposedRoomChanges(gateway);
 const begun=await app.rpc('owner_begin_room_sheet_review',{p_wedding:w});if(begun.error)throw begun.error;const run=begun.data;
 for(const row of rows){const c=row.normalized.change;const proposed=c??{validationCodes:row.normalized.codes,rowNumber:row.rowNumber};const staged=await app.rpc('owner_stage_room_sheet_change',{p_wedding:w,p_run:run,p_change_key:`row-${row.rowNumber}`,p_allocation:c?.allocationId??null,p_room:c?.roomId??null,p_base_revision:c?.expectedSyncRevision??0,p_proposed:proposed});if(staged.error)throw staged.error;}
 const preview=await app.rpc('owner_preview_room_sheet_changes',{p_wedding:w,p_run:run});if(preview.error)throw preview.error;
 }catch(e){console.error('[room sheet] review',e);fail(w);}finish(w,'reviewed');}
export async function commitReviewedRoomSheetChanges(fd:FormData){const w=t(fd,'weddingId'),run=t(fd,'runId'),ids=fd.getAll('changeId').map(String).filter(Boolean);if(!ids.length)fail(w,'selection');try{const app=(await serverClientRW()).schema('app');const result=await app.rpc('owner_commit_room_sheet_changes',{p_wedding:w,p_run:run,p_change_ids:ids});if(result.error)throw result.error;await exportAuthoritative(w,await connection(w));}catch(e){console.error('[room sheet] commit',e);fail(w);}finish(w,'committed');}
