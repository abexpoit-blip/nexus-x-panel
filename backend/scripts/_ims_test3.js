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
  const ph = probe.data;
  const tpl = ph.match(/['"]([^'"]*data_smscdr\.php[^'"]*)['"]/)[1];
  // extract sesskey from template
  const sesskey = tpl.match(/sesskey=([^&'"]+)/)?.[1];
  console.log('sesskey:', sesskey);
  const fmt = d => { const p=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
  const now = new Date(); const past = new Date(Date.now()-48*3600*1000);
  // Build URL exactly matching template format
  const url = `/client/res/data_smscdr.php?fdate1=${encodeURIComponent(fmt(past))}&fdate2=${encodeURIComponent(fmt(now))}&frange=&fnum=&fcli=&fgdate=&fgmonth=&fgrange=&fgnumber=&fgcli=&fg=0&sesskey=${sesskey}&sEcho=1&iColumns=6&sColumns=,,,,,&iDisplayStart=0&iDisplayLength=25&iSortCol_0=0&sSortDir_0=desc&iSortingCols=1&mDataProp_0=0&mDataProp_1=1&mDataProp_2=2&mDataProp_3=3&mDataProp_4=4&mDataProp_5=5&_=${Date.now()}`;
  await new Promise(r=>setTimeout(r, 16000));
  const r = await c.get(url, { headers: {'X-Requested-With':'XMLHttpRequest','Referer':'https://www.imssms.org/client/SMSCDRStats','Accept':'application/json, text/javascript, */*; q=0.01'}});
  console.log('cdr status', r.status, 'type', typeof r.data);
  if (typeof r.data === 'object') {
    console.log('keys', Object.keys(r.data));
    console.log('iTotal', r.data.iTotalRecords, r.data.iTotalDisplayRecords);
    console.log('first 3 rows:', JSON.stringify((r.data.aaData||[]).slice(0,3), null, 2));
  } else {
    console.log('preview:', String(r.data).slice(0, 600));
  }
})().catch(e=>console.error('ERR',e.message));
