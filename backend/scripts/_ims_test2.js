const axios = require('axios');
const tough = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');
(async () => {
  const jar = new tough.CookieJar();
  const c = wrapper(axios.create({ baseURL: 'https://www.imssms.org', jar, withCredentials: true, maxRedirects: 5, validateStatus: s => s < 500, headers: { 'User-Agent': 'Mozilla/5.0 Chrome/121' } }));
  const r1 = await c.get('/login'); const html=r1.data;
  const etkk = html.match(/name=['"]etkk['"]\s+value=['"]([^'"]+)['"]/)?.[1];
  const cap = html.match(/What is\s*(\d+)\s*([+\-x*\/])\s*(\d+)/i);
  const a=+cap[1],b=+cap[3],op=cap[2]; const ans = String(op==='+'?a+b:op==='-'?a-b:op==='*'?a*b:Math.floor(a/b));
  await c.post('/signin', new URLSearchParams({ etkk, username:'Shovonkhan7', password:'Shovonkhan7', capt: ans }).toString(), { headers:{'Content-Type':'application/x-www-form-urlencoded','Referer':'https://www.imssms.org/login'}});
  const probe = await c.get('/client/SMSCDRStats');
  // Extract the full ajax URL pattern from the page
  const ph = probe.data;
  const urlM = ph.match(/['"]([^'"]*data_smscdr\.php[^'"]*)['"]/);
  console.log('ajax url template:', urlM?.[1]);
  // Try a 2-day window
  const fmt = d => { const p=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
  const now = new Date(); const past = new Date(Date.now()-48*3600*1000);
  const params = new URLSearchParams({
    fdate1: fmt(past), fdate2: fmt(now),
    frange:'', fnum:'', fcli:'', fgdate:'0', fgrange:'0', fgnumber:'0', fgcli:'0', fg:'0',
    sEcho: String(Date.now()%100000), iColumns:'6', sColumns:',,,,,',
    iDisplayStart:'0', iDisplayLength:'25', sSearch:'', bRegex:'false',
    iSortCol_0:'0', sSortDir_0:'desc', iSortingCols:'1', _: String(Date.now()),
  });
  for (let i=0;i<6;i++){ params.set(`mDataProp_${i}`,String(i)); params.set(`sSearch_${i}`,''); params.set(`bRegex_${i}`,'false'); params.set(`bSearchable_${i}`,'true'); params.set(`bSortable_${i}`,'true'); }
  const r = await c.get(`/client/res/data_smscdr.php?${params.toString()}`, { headers: {'X-Requested-With':'XMLHttpRequest','Referer':'https://www.imssms.org/client/SMSCDRStats','Accept':'application/json, text/javascript, */*; q=0.01'}});
  console.log('cdr status', r.status, 'type', typeof r.data);
  if (typeof r.data === 'object') {
    console.log('keys', Object.keys(r.data));
    console.log('iTotal', r.data.iTotalRecords, r.data.iTotalDisplayRecords);
    console.log('first 3 rows:', JSON.stringify((r.data.aaData||[]).slice(0,3), null, 2));
  } else {
    console.log('preview:', String(r.data).slice(0, 600));
  }
})().catch(e=>console.error('ERR',e.message));
