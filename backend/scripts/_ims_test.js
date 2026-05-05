const axios = require('axios');
const tough = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');
(async () => {
  const jar = new tough.CookieJar();
  const c = wrapper(axios.create({ baseURL: 'https://www.imssms.org', jar, withCredentials: true, maxRedirects: 5, validateStatus: s => s < 500, headers: { 'User-Agent': 'Mozilla/5.0 Chrome/121' } }));
  const r1 = await c.get('/login');
  const html = r1.data;
  const etkk = html.match(/name=['"]etkk['"]\s+value=['"]([^'"]+)['"]/)?.[1];
  const cap = html.match(/What is\s*(\d+)\s*([+\-x*\/])\s*(\d+)/i);
  let ans = '';
  if (cap) { const a=+cap[1],b=+cap[3],op=cap[2]; ans = String(op==='+'?a+b:op==='-'?a-b:op==='*'||op==='x'?a*b:Math.floor(a/b)); }
  console.log('etkk=', etkk, 'cap=', cap?.[0], 'ans=', ans);
  const form = new URLSearchParams({ etkk: etkk||'', username:'Shovonkhan7', password:'Shovonkhan7', capt: ans });
  const r2 = await c.post('/signin', form.toString(), { headers: { 'Content-Type':'application/x-www-form-urlencoded', 'Referer':'https://www.imssms.org/login' }});
  console.log('signin status', r2.status, 'final', r2.request?.res?.responseUrl);
  const probe = await c.get('/client/SMSCDRStats');
  const ph = String(probe.data || '');
  console.log('probe', probe.status, 'final', probe.request?.res?.responseUrl, 'title', ph.match(/<title>(.*?)<\/title>/i)?.[1]);
  // find AJAX endpoint
  const m = ph.match(/data_smscdr[^"' )]*|ajax[^"' )]*\.php[^"' )]*/gi);
  console.log('ajax candidates:', m?.slice(0,8));
})().catch(e=>console.error('ERR',e.message));
