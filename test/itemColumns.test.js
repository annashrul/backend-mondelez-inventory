import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {itemColumnRenames,toPublicItem,fromPublicItem,toPublicGroup} from '../src/config/itemColumns.js';
process.env.NODE_ENV='test';
const directory=await mkdtemp(path.join(tmpdir(),'item-column-contract-'));
process.env.DATA_FILE=path.join(directory,'store.json');
const {seedData}=await import('../src/data/seed.js');
await writeFile(process.env.DATA_FILE,JSON.stringify(seedData));
const {default:app}=await import('../src/server.js');
const server=app.listen(0);await new Promise(resolve=>server.once('listening',resolve));
const base=`http://127.0.0.1:${server.address().port}/api/v1`;
after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});});
async function request(url,method='GET',body){const response=await fetch(base+url,{method,headers:{'Content-Type':'application/json',connection:'close'},body:body===undefined?undefined:JSON.stringify(body)});return{status:response.status,body:await response.json()};}
function english(row,table){for(const [old,current]of Object.entries(itemColumnRenames[table])){assert.ok(!Object.hasOwn(row,old),old);assert.ok(Object.hasOwn(row,current),current);}}

test('item contract roundtrips values and related group without renaming unrelated unit/rack fields',()=>{
 const input={id:1,kode:'I-1',nama:'Modular Chain',stok:0,stok_min:0,harga:12.5,kelompok_id:1,satuan_id:2,rak_id:3,deskripsi:null,kelompok_detail:{kode:'G-1',nama:'Chain',deskripsi:'Group'},satuan_detail:{nama:'pcs'},rak_detail:{nama:'Rak A'}};
 const canonical=toPublicItem(input);english(canonical,'items');english(canonical.kelompok_detail,'item_groups');
 assert.equal(canonical.stock,0);assert.equal(canonical.description,null);
 assert.deepEqual(fromPublicItem(canonical),input);
 assert.deepEqual(canonical.satuan_detail,input.satuan_detail);
 assert.deepEqual(canonical.rak_detail,input.rak_detail);
 assert.throws(()=>toPublicGroup({kode:'A',code:'B'}),error=>error.status===422);
});

test('raw item/group APIs create, update, generate codes and search with canonical fields',async()=>{
 const group=await request('/kelompok-barang','POST',{code:'GR-COLUMN',name:'Column Group',description:'Group detail'});
 assert.equal(group.status,201);english(group.body,'item_groups');
 const payload={code:'ITEM-COLUMN',barcode:'COL-20261016',name:'Modular Chain',item_group_id:group.body.id,unit_id:1,rack_id:1,stock:10,min_stock:2,price:50,description:'Original description'};
 const created=await request('/barang','POST',payload);assert.equal(created.status,201);english(created.body,'items');
 assert.equal(created.body.name,payload.name);assert.equal(created.body.description,payload.description);english(created.body.kelompok_detail,'item_groups');
 const updated=await request(`/barang/${created.body.id}`,'PUT',{description:'Edited description',price:75});
 assert.equal(updated.status,200);assert.equal(updated.body.description,'Edited description');assert.equal(updated.body.price,75);
 for(const endpoint of ['/barang/kode-otomatis','/kelompok-barang/kode-otomatis']){
  const result=await request(endpoint);assert.equal(result.status,200);assert.equal(typeof result.body.code,'string');assert.ok(!Object.hasOwn(result.body,'kode'));
 }
 const fuzzy=await request('/barang?search=blockchain&fuzzy=true&search_method=text&limit=100');
 assert.equal(fuzzy.status,200);const match=fuzzy.body.data.find(row=>row.id===created.body.id);assert.ok(match);english(match,'items');
 const {readStore}=await import('../src/config/store.js');const audit=(await readStore()).search_audit.find(row=>row.id===fuzzy.body.search_audit_id);
 assert.ok(audit.results.some(row=>row.nama==='Modular Chain'&&row.kode==='ITEM-COLUMN'),'audit snapshot keeps its existing schema');
 const count=await request(`/kelompok-barang/${group.body.id}`);assert.equal(count.body.jumlah_barang,1);
 const invalid=await request('/barang','POST',{...payload,code:'BAD-COLUMN',stock:-1});assert.equal(invalid.status,422);
});

test('raw level/location APIs use English fields and preserve permissions and rack links',async()=>{
 const {masterColumnRenames}=await import('../src/config/masterColumns.js');
 const check=(row,table)=>{for(const [old,current]of Object.entries(masterColumnRenames[table])){assert.ok(!Object.hasOwn(row,old),old);assert.ok(Object.hasOwn(row,current),current);}};
 const menus=(await request('/menus')).body;const action=menus[0].actions[0];
 const level=await request('/level-pengguna','POST',{code:'LVL-COLUMN',name:'Column Level',description:'Level detail',action_ids:[action.id]});
 assert.equal(level.status,201);check(level.body,'levels');assert.deepEqual(level.body.permissions,[action.permission]);assert.equal(level.body.access_rights,'1 permission');
 const edited=await request(`/level-pengguna/${level.body.id}`,'PUT',{name:'Edited Level',action_ids:[]});assert.equal(edited.status,200);assert.equal(edited.body.name,'Edited Level');assert.deepEqual(edited.body.permissions,[]);assert.equal(edited.body.access_rights,'0 permission');
 const location=await request('/lokasi','POST',{code:'LOC-COLUMN',name:'Column Warehouse',address:'Original address',description:'Location detail'});
 assert.equal(location.status,201);check(location.body,'locations');
 const changed=await request(`/lokasi/${location.body.id}`,'PUT',{address:'Updated address'});assert.equal(changed.status,200);assert.equal(changed.body.address,'Updated address');
 const rack=await request('/rak','POST',{kode:'RAK-COLUMN',nama:'Linked Rack',lokasi_id:location.body.id,kapasitas:100});assert.equal(rack.status,201);assert.equal(rack.body.lokasi_detail.nama,'Column Warehouse');
 assert.equal((await request(`/lokasi/${location.body.id}`)).body.jumlah_rak,1);assert.equal((await request(`/lokasi/${location.body.id}`,'DELETE')).status,409);
 for(const endpoint of ['/level-pengguna/kode-otomatis','/lokasi/kode-otomatis']){const result=await request(endpoint);assert.equal(result.status,200);assert.equal(typeof result.body.code,'string');assert.ok(!Object.hasOwn(result.body,'kode'));}
 assert.equal((await request('/level-pengguna','POST',{code:'X',kode:'Y',name:'Conflict'})).status,422);
});

test('raw menu API returns English columns and keeps stable permission keys and action IDs',async()=>{
 const response=await request('/menus');assert.equal(response.status,200);assert.equal(response.body.length,15);
 const {menuColumnRenames,toPublicMenu}=await import('../src/config/menuColumns.js');
 const {catalogWithIds}=await import('../src/data/menuCatalog.js');
 const original=catalogWithIds();assert.deepEqual(response.body,original.map(toPublicMenu));
 for(const [index,menu]of response.body.entries()){
  for(const [old,current]of Object.entries(menuColumnRenames.menus)){assert.ok(!Object.hasOwn(menu,old));assert.ok(Object.hasOwn(menu,current));}
  assert.equal(menu.id,original[index].id);assert.equal(menu.sort_order,index+1);assert.equal(menu.is_active,true);
  for(const action of menu.actions){assert.ok(!Object.hasOwn(action,'nama'));assert.ok(!Object.hasOwn(action,'urutan'));assert.equal(typeof action.name,'string');assert.equal(typeof action.sort_order,'number');assert.equal(action.permission,`${menu.key}.${action.key}`);}
 }
});
