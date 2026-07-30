type Editable = { occupancyPlan:string; guestIds:string[]; checkIn:string|null; checkOut:string|null; singleReason:string|null; status:string; notes:string|null };
const ORDER:(keyof Editable)[]=['occupancyPlan','guestIds','checkIn','checkOut','singleReason','status','notes'];
export function diffRoomSheetChange(current:Editable,next:Editable):(keyof Editable)[]{
  return ORDER.filter((key)=>JSON.stringify(current[key])!==JSON.stringify(next[key]));
}
