import test from 'node:test';
import assert from 'node:assert/strict';
import { registerAdminUserRoutes, wouldDisableLastAdmin } from '../src/admin-user-routes.js';

const noop=()=>{};
function routeHarness({dbError,body={email:' Admin@GyA.com ',password:'contraseña-de-prueba-123'}}={}) {
  let handler, middleware, inserted;
  const app={post:(path,...args)=>{assert.equal(path,'/api/users/admin');middleware=args.slice(0,-1);handler=args.at(-1);}};
  const auth=()=>{},adminOnly=()=>{};
  const pool={query:async(...args)=>{inserted=args;if(dbError)throw dbError;return {rowCount:1};}};
  registerAdminUserRoutes(app,{auth,adminOnly,pool,hashPassword:async pwd=>`HASH(${pwd})`});
  assert.deepEqual(middleware,[auth,adminOnly],'la ruta exige autenticación y rol administrador');
  const res={statusCode:200,result:null,status(code){this.statusCode=code;return this;},json(data){this.result=data;return this;}};
  const errors=[];
  const execute=async()=>handler({body},res,e=>errors.push(e));
  return {execute,res,errors,get inserted(){return inserted;}};
}

test('crea administradores con correo normalizado, rol fijo y hash; no expone la contraseña',async()=>{
  const h=routeHarness(); await h.execute();
  assert.equal(h.res.statusCode,201);
  assert.equal(h.res.result.user.email,'admin@gya.com');
  assert.equal(h.res.result.user.role,'admin');
  assert.equal(h.res.result.user.clientId,null);
  assert.equal(h.res.result.user.isActive,true);
  assert.match(h.inserted[0],/INSERT INTO users/);
  assert.equal(h.inserted[1][1],'admin@gya.com');
  assert.equal(h.inserted[1][2],'HASH(contraseña-de-prueba-123)');
  assert.equal(h.inserted[1][3],'admin');
  assert.doesNotMatch(JSON.stringify(h.res.result),/contraseña-de-prueba/);
});

test('rechaza correo inválido o contraseña demasiado corta',async()=>{
  for(const body of [{email:'invalido',password:'contraseña-de-prueba-123'},
    {email:'admin@gya.com',password:'poca'},
    {email:'admin@gya.com',password:'x'.repeat(129)},
    {email:'admin@gya.com'}]) {
    const h=routeHarness({body});await h.execute();
    assert.equal(h.res.statusCode,400);
    assert.equal(h.inserted,undefined);
  }
});

test('correo repetido responde 409, sin propagar error SQL',async()=>{
  const h=routeHarness({dbError:{code:'23505'}});await h.execute();
  assert.equal(h.res.statusCode,409);
  assert.equal(h.errors.length,0);
});

test('errores inesperados pasan al manejador de errores',async()=>{
  const e=new Error('fallo de base');const h=routeHarness({dbError:e});await h.execute();
  assert.equal(h.errors[0],e);
});

test('el último administrador activo no puede desactivarse',()=>{
  assert.equal(wouldDisableLastAdmin({role:'admin',is_active:true},false,1),true);
  assert.equal(wouldDisableLastAdmin({role:'admin',is_active:true},false,2),false);
  assert.equal(wouldDisableLastAdmin({role:'admin',is_active:false},false,1),false);
  assert.equal(wouldDisableLastAdmin({role:'client',is_active:true},false,1),false);
  assert.equal(wouldDisableLastAdmin({role:'admin',is_active:true},true,1),false);
});
