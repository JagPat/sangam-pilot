const prohibitedLabels=[
  /\bbank\s+(?:account|a\/c)\b/i,
  /\bifsc\b/i,
  /\b(?:credit\s+|debit\s+)?card\s+(?:number|no\.?)\b/i,
  /\bsource\s+of\s+funds\b/i,
  /\bfunding\s+sources?\b/i,
  /\bcontributions?\b/i,
  /\b(?:family|private)\s+settlements?\b/i,
  /\b(?:available\s+)?family\s+balance\b/i,
  /\bpayer\s+family\b/i,
  /\bpaid\s+by\s+family\b/i,
  /\baccount\s+(?:number|no\.?)\b/i,
  /\bbank\s+details?\b/i,
  /\b(?:credit\s+|debit\s+)?card\s+details?\b/i,
  /\bfamily\s+fundings?\b/i,
];

export function validateOfficialCostText(value:string):{ok:true}|{ok:false;reason:string}{
  if(prohibitedLabels.some((label)=>label.test(value))){
    return {ok:false,reason:'Do not enter bank details, family contributions, funding sources or private settlements.'};
  }
  return {ok:true};
}
