import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
process.env.NODE_ENV = 'test';
const directory = await mkdtemp(path.join(tmpdir(), 'inventory-search-audit-'));
process.env.DATA_FILE = path.join(directory,'store.json');
const { seedData } = await import('../src/data/seed.js');
await writeFile(process.env.DATA_FILE, JSON.stringify({ ...seedData, search_audit: [], log_activity: [] }));
const { default: app } = await import('../src/server.js');
const { readStore } = await import('../src/config/store.js');
const { createToken } = await import('../src/services/authService.js');
const { findUser } = await import('../src/repositories/accessRepository.js');
const { summarizeSearches, feedbackSearch } = await import('../src/services/searchAuditService.js');
const { searchAudit } = await import('../src/middleware/searchAudit.js');
const user = await findUser(1);
const server = app.listen(0);
await new Promise(resolve => server.once('listening',resolve));
const base = `http://127.0.0.1:${server.address().port}/api/v1`;
const auth = { Authorization: `Bearer ${createToken(user)}`, 'Content-Type': 'application/json', connection: 'close' };
async function request(url, method='GET', body, headers=auth) {
  const result = await fetch(base+url, { method,headers,body:body === undefined ? undefined : JSON.stringify(body) });
  return { status: result.status, body: await result.json() };
}
const entries = async () => (await readStore()).search_audit;
after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(directory,{recursive:true,force:true}); });

test('logs each actual search once with accurate totals, ranking and selected feedback', async () => {
  const item = seedData.barang[0];
  const found = await request(`/barang?search=${encodeURIComponent(item.nama)}&fuzzy=true&search_method=voice&limit=1`);
  assert.equal(found.status,200);
  assert.ok(found.body.search_audit_id);
  let row = (await entries()).find(row => row.id === found.body.search_audit_id);
  assert.equal(row.user_id,Number(user.id));
  assert.equal(row.method,'voice'); assert.equal(row.status,'found');
  assert.equal(row.result_count,found.body.pagination.total);
  assert.equal(row.returned_count,1); assert.equal(row.results[0].rank,1);
  assert.ok(row.duration_ms >= 0);
  assert.equal((await request(`/search-audit/${row.id}/feedback`,'PATCH',{verdict:'correct',item_id:row.results[0].id})).status,200);
  assert.equal((await request(`/search-audit/${row.id}/feedback`,'PATCH',{verdict:'selected',item_id:row.results[0].id})).status,200);
  row = (await entries()).find(entry => entry.id === row.id);
  assert.equal(row.relevance,true); assert.equal(row.selected_rank,1);
  assert.equal((await entries()).filter(entry => entry.id === row.id).length,1);
  const before = (await entries()).length;
  await request('/barang?search=normal-master-search');
  assert.equal((await entries()).length,before,'master searches are excluded');
});

test('separates no results, camera, gallery, rack and backend errors without saving photos', async () => {
  const none = await request('/barang?search=zzzzzzzzzzzzzzzzzz&fuzzy=true&search_method=text');
  assert.equal((await entries()).find(row => row.id === none.body.search_audit_id).status,'not_found');
  for (const method of ['camera','gallery']) {
    const photo = 'data:image/jpeg;base64,PRIVATE_PHOTO_BYTES';
    const result = await request('/ai/search-image','POST',{image:photo,search_method:method,limit:3});
    assert.equal(result.status,200);
    const row = (await entries()).find(row => row.id === result.body.search_audit_id);
    assert.equal(row.method,method); assert.equal(row.model,'test-model');
    assert.equal(row.returned_count,result.body.results.length);
    assert.doesNotMatch(JSON.stringify(row),/PRIVATE_PHOTO_BYTES/);
  }
  await request('/ai/search-image','POST',{search_method:'gallery'});
  assert.equal((await entries()).at(-1).status,'error');
  assert.equal((await entries()).at(-1).http_status,400);
  await request('/rak/items','POST',{qr_code:seedData.rak[0].qr_code});
  assert.equal((await entries()).at(-1).method,'rack');
});

test('feedback requires ownership and a real result; errors cannot become relevance judgments', async () => {
  const row = (await entries()).find(row => row.status === 'found');
  await assert.rejects(feedbackSearch(row.id,999999,{verdict:'correct',item_id:row.results[0].id}), error => error.status === 404);
  await assert.rejects(feedbackSearch(row.id,Number(user.id),{verdict:'correct',item_id:999999}), error => error.status === 422);
  const failure = (await entries()).find(row => row.status === 'error');
  await assert.rejects(feedbackSearch(failure.id,Number(user.id),{verdict:'incorrect'}), error => error.status === 422);
  const denied = await request('/search-audit', 'GET',undefined,{'Content-Type':'application/json',connection:'close'});
  assert.equal(denied.status,401);
  assert.equal((await request(`/search-audit/${row.id}/feedback`,'PATCH',{verdict:'correct',item_id:row.results[0].id},{connection:'close','Content-Type':'application/json'})).status,401);
});

test('summary uses reviewed-only accuracy and excludes system errors from not-found rate', () => {
  const [summary] = summarizeSearches([
    {method:'camera',status:'found',relevance:true,duration_ms:100},
    {method:'camera',status:'found',relevance:null,duration_ms:200},
    {method:'camera',status:'not_found',relevance:false,duration_ms:300},
    {method:'camera',status:'error',relevance:null,duration_ms:400},
  ]);
  assert.equal(summary.total,4); assert.equal(summary.reviewed,2);
  assert.equal(summary.accuracy_reviewed,50); assert.equal(summary.not_found_rate,33.33);
  assert.equal(summary.error_rate,25); assert.equal(summary.avg_duration_ms,250);
  assert.equal(summarizeSearches([])[0].accuracy_reviewed,null);
});

test('audit list filters before pagination and validates dates and permissions', async () => {
  const result = await request('/search-audit?method=voice&limit=1');
  assert.equal(result.status,200); assert.equal(result.body.data.length,1);
  assert.ok(result.body.data.every(row => row.method === 'voice'));
  assert.equal(result.body.summary.find(row => row.method === 'voice').total,result.body.total);
  assert.equal((await request('/search-audit?from=bad-date')).status,422);
  assert.equal((await request('/search-audit?method=invalid')).status,422);
  const otherToken = createToken({id:98765,status:'Aktif'});
  assert.equal((await request('/search-audit','GET',undefined,{Authorization:`Bearer ${otherToken}`,connection:'close'})).status,403);
});

test('audit failures preserve search responses and disconnected requests are recorded once', async () => {
  let close, saved;
  const req = {method:'GET',originalUrl:'/api/v1/barang',query:{search:'chain',search_method:'text'},headers:{}};
  let sent;
  const res = {statusCode:200,once(event,callback){close=callback;},json(body){sent=body;}};
  const originalError = console.error; console.error = () => {};
  try {
    searchAudit({record:async () => {throw new Error('offline');}})(req,res,() => {});
    res.json({data:[],pagination:{total:0}});
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(sent,{data:[],pagination:{total:0}});
    let calls=0;
    searchAudit({record:async entry => {saved=entry;calls++;}})(req,{...res,once(event,callback){close=callback;}},() => {});
    close(); close();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls,1); assert.equal(saved.http_status,499); assert.equal(saved.status,'error');
  } finally { console.error=originalError; }
});
