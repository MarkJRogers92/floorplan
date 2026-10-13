// Actual Chromium application check. Synthetic network only; no providers or live engine.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
const output = '.superpowers/sdd/2026-10-13-office-experiment'
mkdirSync(output, { recursive: true })
const target = await (await fetch('http://127.0.0.1:9229/json/new?about:blank', { method: 'PUT' })).json()
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise(resolve => ws.addEventListener('open', () => resolve(), { once: true }))
let id = 0
const waiting = new Map()
ws.addEventListener('message', e => { const m = JSON.parse(String(e.data)); if (m.id) { waiting.get(m.id)?.(m); waiting.delete(m.id) } })
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const n = ++id; waiting.set(n, m => m.error ? reject(m.error) : resolve(m.result)); ws.send(JSON.stringify({ id: n, method, params }))
})
const run = async expression => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
  return result.result.value
}
const fixture = `
window.calls=[]; window.accepted=[]; window.permissionData=[];
const original=window.fetch.bind(window);
window.fetch=async (input,init={})=>{
 const url=new URL(typeof input==='string'?input:input.url, location.href);
 if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/__')) return original(input,init);
 const method=init.method||'GET'; window.calls.push({path:url.pathname,method,body:init.body});
 const path=url.pathname;
 if(path==='/__service'&&window.forceServiceFailure) return Response.json({error:'Connection unavailable. Try Use my project again.'},{status:503});
 let body={};
 if(path==='/__service') body={url:location.origin,password:'synthetic'};
 else if(path==='/__director/state') body={available:true,enabled:true,model:'synthetic',excluded:[],reservedCents:0,runCapCents:100,episodeCapCents:30};
 else if(path==='/__director/control') return new Promise(resolve=>window.releaseDirector=()=>resolve(Response.json({available:true,enabled:true,model:'synthetic',excluded:[],reservedCents:0,runCapCents:100,episodeCapCents:30})));
 else if(path==='/api/location') {
   if(location.search.includes('delay=1')&&!window.delayedLocation){window.delayedLocation=true;return new Promise(resolve=>window.releaseLocation=()=>resolve(Response.json({directory:'/synthetic/project'})));}
   body={directory:'/synthetic/project'};
 }
 else if(path==='/api/project') body=[{id:'p',name:'Toy project',canonical:'/synthetic/project'}];
 else if(path==='/api/agent') body={location:{directory:'/synthetic/project'},data:[{id:'build',name:'Build',mode:'primary',hidden:false,model:{providerID:'fixture',id:'local'}}]};
 else if(path==='/api/session' && method==='POST') { const job={id:'ses_synthetic_job',title:'A toy brief',location:{directory:'/synthetic/project'},agent:'build'}; body={data:job}; window.accepted.push(job); }
 else if(path==='/api/session') body={data:window.accepted};
 else if(path==='/api/session/ses_synthetic_job') body={data:window.accepted[0]};
 else if(path.includes('/message')) body={cursor:{},data:[]};
 else if(path.endsWith('/permission/request')) body={location:{directory:'/synthetic/project'},data:window.permissionData};
 else if(path==='/api/form') body={data:[]};
 else if(path==='/api/event') return new Response(new ReadableStream({start(c){}}),{headers:{'Content-Type':'text/event-stream'}});
 else if(path.includes('/prompt')) { const v=JSON.parse(init.body); body={data:{id:v.id,sessionID:'ses_synthetic_job',type:'user',delivery:v.delivery,payload:{text:v.text}}}; }
 else if(path==='/__series') body={};
 return Response.json(body);
};`
await send('Page.enable')
await send('Page.addScriptToEvaluateOnNewDocument', { source: fixture })
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1040, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: 'http://127.0.0.1:5175/?demo=1' })
await new Promise(r => setTimeout(r, 2200))
const first = await run(`({calls:window.calls,mode:document.body.dataset.mode,script:document.querySelector('#script').innerText,disabled:document.querySelector('#work-submit').disabled,banner:!document.querySelector('#mode-notice').hidden})`)
assert.equal(first.mode, 'demo', JSON.stringify(first))
assert.equal(first.calls.length, 0, JSON.stringify(first.calls))
assert.equal(first.disabled, true)
assert.equal(first.banner, true)
assert.match(await run(`document.querySelector('#stage-cue').textContent`), /dramatised/)
assert.equal(await run(`document.querySelector('#work-notice').innerText`), 'Fictional office footage. Use my project to give your real team a brief.')
await run(`document.querySelector('#demo').click()`)
await new Promise(r => setTimeout(r, 7000))
const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
writeFileSync(output + '/office-desktop.png', Buffer.from(screenshot.data, 'base64'))
const demo = await run(`({calls:window.calls,script:document.querySelector('#script').innerText,overflow:document.documentElement.scrollWidth>innerWidth})`)
assert.equal(demo.calls.length, 0)
assert.equal(demo.overflow, false)
assert.match(demo.script, /build|review/)
await run(`document.querySelector('#live').click()`)
await new Promise(r => setTimeout(r, 1000))
const live = await run(`({mode:document.body.dataset.mode,agent:document.querySelector('#work-agent').value,project:document.querySelector('#work-project-picker').value,post:window.calls.filter(c=>c.method==='POST'),banner:!document.querySelector('#mode-notice').hidden})`)
assert.equal(live.mode, 'live')
assert.equal(live.agent, 'build')
assert.equal(live.project, '/synthetic/project')
assert.equal(live.post.length, 0)
assert.equal(live.banner, false)
await run(`document.querySelector('#work-prompt').focus()`)
await send('Input.insertText', { text: 'A synthetic brief, never executed' })
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
assert.equal(await run('document.activeElement.id'), 'work-submit')
assert.equal(await run(`document.querySelector('#work-form').checkValidity() && !document.querySelector('#work-submit').disabled`), true)
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' })
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
await new Promise(r => setTimeout(r, 1000))
const job = await run(`({posts:window.calls.filter(c=>c.method==='POST'),submit:document.querySelector('#work-submit').innerText,prompt:document.querySelector('#work-prompt').value})`)
assert.equal(job.posts.length, 2, JSON.stringify(job))
assert.equal(job.prompt, '')
assert.equal(job.submit, 'Send follow-up')
await run(`window.permissionData=[{id:'per_fixture',sessionID:'ses_synthetic_job',action:'shell',resources:['/synthetic/safe']}]; document.querySelector('#work-refresh').click()`)
await new Promise(r => setTimeout(r, 200))
assert.equal(await run(`document.querySelector('#office-settings').open`), false)
assert.match(await run(`document.querySelector('#work-permissions').innerText`), /Allow once/)
await run(`document.querySelector('#director').click()`)
await new Promise(r => setTimeout(r, 100))
await run(`document.querySelector('#demo').click()`)
await run(`window.releaseDirector()`)
assert.equal(await run(`document.querySelector('#work-permissions').innerText`), '')
assert.equal(await run(`document.querySelector('#work-roster').innerText.includes('On this brief')`), false)
const beforeDemo = await run('window.calls.length')
await new Promise(r => setTimeout(r, 2200))
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
await new Promise(r => setTimeout(r, 300))
assert.ok(await run(`document.querySelector('#work-notice').getBoundingClientRect().width >= 260`), 'Phone notice was squeezed by action buttons')
const narrow = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
writeFileSync(output + '/office-mobile.png', Buffer.from(narrow.data, 'base64'))
assert.equal(await run('document.documentElement.scrollWidth>innerWidth'), false)
await new Promise(r => setTimeout(r, 18000))
assert.equal(await run('window.calls.length'), beforeDemo, 'Enabled/late Director or archival IO escaped demo')
assert.match(await run(`document.querySelector('#script').innerText`), /The episode wrapped/)
assert.equal(await run(`document.querySelector('#director').disabled`), true)
await run(`document.querySelector('#live').click()`)
await new Promise(r => setTimeout(r, 500))
await run(`document.querySelector('#director').click()`)
await new Promise(r => setTimeout(r, 100))
await run(`document.querySelector('#demo').click(); document.querySelector('#live').click()`)
await new Promise(r => setTimeout(r, 500))
await run(`window.releaseDirector()`)
await new Promise(r => setTimeout(r, 100))
assert.match(await run(`document.querySelector('#director').textContent`), /Enable Director/, 'A stale pre-demo opt-in re-enabled narration after return')
await run(`document.querySelector('#work-prompt').value='Keep this draft'; document.querySelector('#work-new').click()`)
await new Promise(r => setTimeout(r, 250))
assert.equal(await run(`document.querySelector('#work-agent').value`), 'build')
assert.equal(await run(`document.querySelector('#work-prompt').value`), 'Keep this draft')
assert.equal(await run(`document.querySelector('#work-submit').textContent`), "Let's do it")
await send('Page.navigate', { url: 'http://127.0.0.1:5175/?delay=1' })
await new Promise(r => setTimeout(r, 500))
await run(`document.querySelector('#demo').click(); window.releaseLocation()`)
await new Promise(r => setTimeout(r, 100))
await run(`document.querySelector('#live').click()`)
await new Promise(r => setTimeout(r, 500))
assert.equal(await run(`document.querySelector('#work-agent').value`), 'build', 'Canceled startup metadata was never prepared again')
await run(`document.querySelector('#demo').click(); window.forceServiceFailure=true`)
await new Promise(r => setTimeout(r, 500))
const linesBeforeFailure = await run(`document.querySelectorAll('#script .line').length`)
await run(`document.querySelector('#live').click()`)
await new Promise(r => setTimeout(r, 100))
assert.match(await run(`document.querySelector('#status').textContent`), /Connection unavailable/)
await new Promise(r => setTimeout(r, 3000))
const failedReconnect = {
  visible: await run(`getComputedStyle(document.querySelector('#status')).display`) !== 'none',
  advances: await run(`document.querySelectorAll('#script .line').length`) > linesBeforeFailure,
}
assert.deepEqual(failedReconnect, { visible: true, advances: true }, 'Failed reconnect hid the error or froze the demo')
console.log(JSON.stringify({ first, demo, live, job, mobile: 'no horizontal overflow' }, null, 2))
await send('Page.close'); ws.close()
