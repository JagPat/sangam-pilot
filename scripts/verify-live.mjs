const base=(process.env.LIVE_BASE_URL??'https://sangam.vitan.in').replace(/\/$/,'');
const health=await fetch(`${base}/api/health`,{headers:{'cache-control':'no-cache'}});
if(!health.ok) throw new Error(`health endpoint returned ${health.status}`);
const body=await health.json();
if(body.status!=='ok'||body.service!=='sangam'||body.configured!==true) throw new Error(`unhealthy deployment: ${JSON.stringify(body)}`);

for(const path of ['/','/login']){
  const response=await fetch(`${base}${path}`,{redirect:'follow'});
  if(!response.ok) throw new Error(`${path} returned ${response.status}`);
  const html=await response.text();
  if(/Private finance|Finance & vendors|family contribution|bank statement/i.test(html))
    throw new Error(`${path} exposed retired private-finance language`);
}

for(const path of ['/host/finance','/host/costs','/host/budget']){
  const response=await fetch(`${base}${path}`,{redirect:'manual'});
  if(![302,303,307,308].includes(response.status)) throw new Error(`${path} did not fail closed for an anonymous caller (${response.status})`);
}
console.log(`LIVE SMOKE PASSED (${body.release})`);
