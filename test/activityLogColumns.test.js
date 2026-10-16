import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeActivityLog } from '../src/config/activityLogColumns.js';

test('historical local log rows migrate to English column keys without changing their values',()=>{
  const original={id:1,waktu:'2026-10-16T01:02:03Z',aksi:'Login',modul:'Auth',detail:'Login berhasil',ip:'127.0.0.1'};
  const actual=normalizeActivityLog(original);
  assert.deepEqual(actual,{id:1,occurred_at:original.waktu,action:'Login',module:'Auth',detail:'Login berhasil',ip:'127.0.0.1'});
  assert.deepEqual(normalizeActivityLog(actual),actual);
  assert.equal(original.aksi,'Login');
  assert.throws(()=>normalizeActivityLog({aksi:'A',action:'B'}),/Conflicting activity log columns/);
});

test('production log writes and reads use the same English schema',async()=>{
  const source=(await readFile(new URL('../src/services/activityLogger.js',import.meta.url),'utf8'))
    .replace(/^import .*;\n/gm,'').replaceAll('export ','').replace("const useTestStore = process.env.NODE_ENV === 'test';",'const useTestStore = false;');
  const calls=[];
  const query=async(sql,values)=>{
    calls.push({sql,values});
    if(sql.includes('information_schema.columns')) return {rows:[{column_name:'user_id'}]};
    if(sql.includes('SELECT a.id')) return {rows:[{id:1,occurred_at:'2026-10-16T01:02:03Z',action:'Login',module:'Auth'}]};
    return {rows:[]};
  };
  const logger=new Function('query','verifyToken',source+'\nreturn {logActivity,listActivities};')(query,()=>({sub:1}));
  await logger.logActivity({userId:1,action:'Login',module:'Auth',detail:'Login berhasil'});
  const insert=calls.find(call=>call.sql.includes('INSERT INTO'));
  assert.match(insert.sql,/activity_logs\(user_id, action, module, detail, ip\)/);
  assert.deepEqual(insert.values,[1,'Login','Auth','Login berhasil',null]);
  const rows=await logger.listActivities('Auth');
  assert.equal(rows[0].action,'Login');
  const select=calls.find(call=>call.sql.includes('SELECT a.id'));
  assert.match(select.sql,/a\.occurred_at/);assert.match(select.sql,/a\.action ILIKE/);assert.match(select.sql,/a\.module ILIKE/);
  assert.match(select.sql,/ORDER BY a\.occurred_at DESC/);
  assert.doesNotMatch(select.sql,/a\.(aksi|modul|waktu)\b/);
});
