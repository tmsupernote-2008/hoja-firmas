/* Cifrado OPCIONAL de los datos de Firmax en este teléfono.
   - Apagado (por defecto): FXV.get/set = localStorage tal cual (sin cambios de comportamiento).
   - Encendido: contraseña -> PBKDF2-SHA256 (310 000 iteraciones, sal aleatoria) -> clave maestra AES-KW 256
     que solo vive en memoria. Cada elemento guardado (hoja, CADA firma, CADA foto, historial, listas…)
     se cifra con su PROPIA clave AES-GCM 256 aleatoria y su propio IV; esa clave va envuelta con la maestra
     (cifrado de sobre). Cambiar la contraseña solo re-envuelve las claves; el contenido no se vuelve a cifrar.
   - Sin recuperación: si se olvida la contraseña, los datos cifrados se pierden. */
(function(){
'use strict';
var META='dwe_crypto_v1',PEND='dwe_link_pending_v1',BLOB='dwe_enc_blob_',SHEET='dwe_signin_sheet_v1',K_MEM='dwe_hdr_mem_v1',K_LISTS='dwe_name_lists_v1';
/* datos sensibles (los demás —idioma, geocerca, admin, supers, roles, ajustes de enlaces— se quedan como están) */
var SENS=[SHEET,K_MEM,'dwe_hdr_hist_v1',K_LISTS,'dwe_changelog_v1','dwe_doc_lastsig','dwe_doc_names','dwe_mail_to','dwe_company_v1'];
var PFX='FXE1:',ITER=310000,MINLEN=6,LOCKS=[1,2,5,15,30];
var IMGF=[['sig','sigV'],['sigO','sigOV'],['photo',null],['photoO',null]];
var T=function(k,p){return window.I18N?window.I18N.t(k,p):k;};
var subtle=(window.crypto&&crypto.subtle)||null;
var te=new TextEncoder(),td=new TextDecoder();
function lsG(k){try{return localStorage.getItem(k);}catch(e){return null;}}
function lsR(k){try{localStorage.removeItem(k);}catch(e){}}
function readMeta(){try{var m=JSON.parse(lsG(META)||'null');return m&&m.v===1&&m.salt&&m.chk?m:null;}catch(e){return null;}}
var M=readMeta(),mk=null,cache={},blobIx=new Map(),isReady=!M,readyCbs=[],beforeLock=[],unlockCbs=[];
var qP=Promise.resolve(),qOn=false,pend={};

/* ---------- utilidades ---------- */
function b64(u){var s='',C=0x8000;for(var i=0;i<u.length;i+=C)s+=String.fromCharCode.apply(null,u.subarray(i,i+C));return btoa(s);}
function unb64(s){var b=atob(s),u=new Uint8Array(b.length);for(var i=0;i<b.length;i++)u[i]=b.charCodeAt(i);return u;}
function rnd(n){return crypto.getRandomValues(new Uint8Array(n));}
function hex(u){return Array.prototype.map.call(u,function(x){return ('0'+x.toString(16)).slice(-2);}).join('');}
function blobKeys(){var a=[];try{for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);if(k&&k.indexOf(BLOB)===0)a.push(k);}}catch(e){}return a;}
function isSens(k){return SENS.indexOf(k)>=0;}

/* ---------- criptografía ---------- */
function derive(pass,saltB64,iter){
  return subtle.importKey('raw',te.encode(String(pass).normalize('NFC')),'PBKDF2',false,['deriveKey']).then(function(bk){
    return subtle.deriveKey({name:'PBKDF2',salt:unb64(saltB64),iterations:iter,hash:'SHA-256'},bk,{name:'AES-KW',length:256},false,['wrapKey','unwrapKey']);});
}
/* sobre: clave de datos AES-GCM 256 aleatoria por elemento, IV aleatorio, nombre del elemento como AAD */
function seal(name,bytes,key){
  var iv=rnd(12),dk;
  return subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt','decrypt']).then(function(k){dk=k;
    return subtle.encrypt({name:'AES-GCM',iv:iv,additionalData:te.encode(name)},dk,bytes);})
  .then(function(ct){return subtle.wrapKey('raw',dk,key||mk,'AES-KW').then(function(wk){
    return PFX+JSON.stringify({wk:b64(new Uint8Array(wk)),iv:b64(iv),ct:b64(new Uint8Array(ct))});});});
}
function parseEnv(s){if(typeof s!=='string'||s.indexOf(PFX)!==0)return null;try{var o=JSON.parse(s.slice(PFX.length));return o&&o.wk&&o.iv&&o.ct?o:null;}catch(e){return null;}}
function unseal(name,o,key){
  return subtle.unwrapKey('raw',unb64(o.wk),key||mk,'AES-KW',{name:'AES-GCM',length:256},false,['decrypt']).then(function(dk){
    return subtle.decrypt({name:'AES-GCM',iv:unb64(o.iv),additionalData:te.encode(name)},dk,unb64(o.ct));}).then(function(b){return new Uint8Array(b);});
}
function rewrap(s,oldK,newK){var o=parseEnv(s);if(!o)return Promise.resolve(s);
  return subtle.unwrapKey('raw',unb64(o.wk),oldK,'AES-KW',{name:'AES-GCM',length:256},true,['encrypt','decrypt'])
  .then(function(dk){return subtle.wrapKey('raw',dk,newK,'AES-KW');})
  .then(function(wk){return PFX+JSON.stringify({wk:b64(new Uint8Array(wk)),iv:o.iv,ct:o.ct});});}
function makeCheck(key){return seal('chk',te.encode('firmax-ok'),key);}
function verify(pass,m){m=m||M;var k;
  return derive(pass,m.salt,m.iter).then(function(key){k=key;var o=parseEnv(m.chk);if(!o)throw new Error('meta');return unseal('chk',o,key);})
  .then(function(b){if(td.decode(b)!=='firmax-ok')throw new Error('bad');return k;},function(){var e=new Error('wrong');e.wrong=true;throw e;});}

/* firmas/fotos: cada una es un elemento aparte con su propia clave (imagen en binario + trazos vectoriales) */
function packBlob(d,vec){var h={v:vec||null},body=new Uint8Array(0),m=/^data:([^;,]+);base64,(.*)$/.exec(d);
  if(m){h.m=m[1];body=unb64(m[2]);}else h.s=d;
  var hb=te.encode(JSON.stringify(h)),out=new Uint8Array(4+hb.length+body.length),dv=new DataView(out.buffer);
  dv.setUint32(0,hb.length);out.set(hb,4);out.set(body,4+hb.length);return out;}
function unpackBlob(u){var n=new DataView(u.buffer,u.byteOffset,u.byteLength).getUint32(0),h=JSON.parse(td.decode(u.subarray(4,4+n)));
  return {d:h.s!=null?h.s:'data:'+h.m+';base64,'+b64(u.subarray(4+n)),v:h.v};}
function sealSheet(str,key,out){ // -> escribe en out {k:v}; devuelve ids usados
  var s=null;try{s=JSON.parse(str);}catch(e){}
  if(!s||!Array.isArray(s.rows))return seal(SHEET,te.encode(str),key).then(function(env){out[SHEET]=env;return [];});
  var jobs=[],keep=[];
  s.rows.forEach(function(r,ri){if(!r)return;IMGF.forEach(function(f){var v=r[f[0]];if(typeof v!=='string'||!v)return;
    // índice por fila+campo+contenido: cada firma/foto es su propio elemento (aunque dos fotos sean idénticas)
    var vec=f[1]?r[f[1]]:null,ck=ri+'|'+f[0]+'|'+v+'\u0000'+(vec?JSON.stringify(vec):''),id=blobIx.get(ck);
    if(!id||!lsG(BLOB+id)||key!==mk){id=hex(rnd(12));(function(id,ck){jobs.push(seal(BLOB+id,packBlob(v,vec),key).then(function(env){out[BLOB+id]=env;blobIx.set(ck,id);}));})(id,ck);}
    keep.push(id);r[f[0]]={$fx:id};if(f[1])r[f[1]]=null;});});
  jobs.push(seal(SHEET,te.encode(JSON.stringify(s)),key).then(function(env){out[SHEET]=env;}));
  return Promise.all(jobs).then(function(){return keep;});
}
function openSheet(o){
  return unseal(SHEET,o).then(function(b){var txt=td.decode(b),s=null;try{s=JSON.parse(txt);}catch(e){}
    if(!s||!Array.isArray(s.rows))return txt;var jobs=[];
    s.rows.forEach(function(r,ri){if(!r)return;IMGF.forEach(function(f){var ref=r[f[0]];if(!ref||typeof ref!=='object'||!ref.$fx)return;var id=ref.$fx;
      var env=parseEnv(lsG(BLOB+id));r[f[0]]='';
      if(!env){console.warn('FXV: falta '+id);return;}
      jobs.push(unseal(BLOB+id,env).then(function(u){var x=unpackBlob(u);r[f[0]]=x.d;if(f[1])r[f[1]]=x.v;blobIx.set(ri+'|'+f[0]+'|'+x.d+'\u0000'+(x.v?JSON.stringify(x.v):''),id);},function(e){console.warn('FXV blob',id,e);}));});});
    return Promise.all(jobs).then(function(){return JSON.stringify(s);});});
}
/* escribe elementos (todo cifrado antes; luego escrituras síncronas) */
function encryptMap(p,key,out){var jobs=[],keep=null;
  Object.keys(p).forEach(function(k){
    if(k===SHEET)jobs.push(sealSheet(p[k],key,out).then(function(kp){keep=kp;}));
    else jobs.push(seal(k,te.encode(p[k]),key).then(function(env){out[k]=env;}));});
  return Promise.all(jobs).then(function(){return keep;});}
function commit(out,keep){
  var ks=Object.keys(out).sort(function(a,b){return (a===SHEET)-(b===SHEET);}); // firmas/fotos antes que la hoja
  ks.forEach(function(k){localStorage.setItem(k,out[k]);});
  if(keep){var ok={};keep.forEach(function(id){ok[BLOB+id]=1;});blobKeys().forEach(function(k){if(!ok[k])lsR(k);});}
}
function enqueue(fn,user){var r=qP.then(fn);qP=r.then(function(){},function(e){if(user)return;console.warn('FXV',e);if(window.FXV&&FXV.onWriteError){try{FXV.onWriteError(e);}catch(_){}}});return user?r:qP;}
function schedule(){if(qOn)return;qOn=true;enqueue(function(){qOn=false;var p=pend;pend={};if(!mk||!M)return;var key=mk,out={};
  return encryptMap(p,key,out).then(function(keep){if(mk!==key||!M)return;commit(out,keep);});});}
function flush(){return enqueue(function(){});}

/* ---------- API para las páginas ---------- */
function get(k){if(!M||!isSens(k))return localStorage.getItem(k);if(!mk)return null;return Object.prototype.hasOwnProperty.call(cache,k)?cache[k]:null;}
function set(k,v){if(!M||!isSens(k)){localStorage.setItem(k,v);return;}if(!mk)return;cache[k]=String(v);pend[k]=cache[k];schedule();}
function remove(k){if(!M||!isSens(k)){localStorage.removeItem(k);return;}if(!mk)return;delete cache[k];delete pend[k];enqueue(function(){lsR(k);if(k===SHEET)blobKeys().forEach(lsR);});}

/* datos que llegaron por enlace mientras estaba bloqueado (sin clave no se pueden cifrar todavía) */
function mergePending(){var raw=lsG(PEND);if(!raw)return;var pd=null;try{pd=JSON.parse(raw);}catch(e){}
  if(pd&&typeof pd==='object'){
    if(pd.mem){var m={};try{m=JSON.parse(get(K_MEM)||'{}')||{};}catch(e){}for(var k in pd.mem)m[k]=pd.mem[k];set(K_MEM,JSON.stringify(m));}
    if(pd.lists){var l={};try{l=JSON.parse(get(K_LISTS)||'{}')||{};}catch(e){}for(var s in pd.lists)l[s]=pd.lists[s];set(K_LISTS,JSON.stringify(l));}}
  lsR(PEND);}
function loadAll(){
  cache={};blobIx.clear();var jobs=[];
  SENS.forEach(function(k){var raw=lsG(k);if(raw==null)return;var o=parseEnv(raw);
    if(!o){cache[k]=raw;pend[k]=raw;return;} // quedó sin cifrar (p. ej. activación interrumpida): se cifra ahora
    jobs.push((k===SHEET?openSheet(o):unseal(k,o).then(function(b){return td.decode(b);})).then(function(v){cache[k]=v;},function(e){console.warn('FXV no se pudo descifrar',k,e);}));});
  return Promise.all(jobs).then(function(){mergePending();if(Object.keys(pend).length)schedule();});
}
function unlockWith(key){mk=key;return loadAll().then(function(){
  hideGate();startIdle();
  if(!isReady){isReady=true;var c=readyCbs;readyCbs=[];c.forEach(function(f){try{f();}catch(e){console.error(e);}});}
  else unlockCbs.forEach(function(f){try{f();}catch(e){console.error(e);}});});}
function unlock(pass){if(!M)return Promise.resolve(true);return verify(pass).then(unlockWith);}

function enable(pass){
  if(M)return Promise.reject(new Error('on'));if(!subtle)return Promise.reject(new Error('nocrypto'));
  if(String(pass).length<MINLEN)return Promise.reject(new Error('short'));
  var salt=b64(rnd(16)),key;
  return flush().then(function(){return derive(pass,salt,ITER);}).then(function(k){key=k;return makeCheck(key);}).then(function(chk){
    var plain={};SENS.forEach(function(k){var v=lsG(k);if(v!=null&&!parseEnv(v))plain[k]=v;});
    var out={};blobIx.clear();
    return encryptMap(plain,key,out).then(function(keep){
      var m={v:1,salt:salt,iter:ITER,chk:chk,lock:5,since:new Date().toISOString()};
      localStorage.setItem(META,JSON.stringify(m)); // primero la marca: lo que quede sin cifrar se cifra al desbloquear
      commit(out,keep||[]);M=m;mk=key;cache=plain;isReady=true;startIdle();});});
}
function disable(pass){if(!M)return Promise.resolve();
  return enqueue(function(){return verify(pass).then(function(){
    var p=pend;pend={};for(var k in p)cache[k]=p[k];
    SENS.forEach(function(k){if(Object.prototype.hasOwnProperty.call(cache,k))localStorage.setItem(k,cache[k]);else if(parseEnv(lsG(k)))lsR(k);});
    blobKeys().forEach(lsR);lsR(META);M=null;mk=null;blobIx.clear();stopIdle();swForget();bc('off');
    var mp=lsG(PEND);if(mp)mergePending();});},true);}
function changePass(oldP,newP){if(!M)return Promise.reject(new Error('off'));if(String(newP).length<MINLEN)return Promise.reject(new Error('short'));
  return enqueue(function(){var oldK,newK,salt=b64(rnd(16));
    return verify(oldP).then(function(k){oldK=k;return derive(newP,salt,ITER);}).then(function(k){newK=k;
      var ks=SENS.concat(blobKeys()),out={},jobs=[];
      ks.forEach(function(k){var raw=lsG(k);if(parseEnv(raw))jobs.push(rewrap(raw,oldK,newK).then(function(s){out[k]=s;}));});
      return Promise.all(jobs).then(function(){return makeCheck(newK);}).then(function(chk){
        var m={};for(var x in M)m[x]=M[x];m.salt=salt;m.iter=ITER;m.chk=chk;
        Object.keys(out).forEach(function(k){localStorage.setItem(k,out[k]);}); // solo cambian las claves envueltas
        localStorage.setItem(META,JSON.stringify(m));M=m;mk=newK;});});},true);}
function wipe(){SENS.forEach(lsR);blobKeys().forEach(lsR);lsR(META);M=null;mk=null;cache={};pend={};blobIx.clear();swForget();bc('off');mergePending();}
function setLockMin(n){if(!M)return;n=+n;if(!(n>0))return;M.lock=n;localStorage.setItem(META,JSON.stringify(M));lastAct=Date.now();}

/* ---------- bloqueo ---------- */
var keepOnLock=null;
function lock(why){if(!M||!mk)return Promise.resolve();
  beforeLock.forEach(function(f){try{f();}catch(e){}});
  return flush().then(function(){mk=null;cache={};pend={};blobIx.clear();stopIdle();swForget();if(why!=='bc')bc('lock');
    if(keepOnLock&&keepOnLock())showGate();else{showGate();location.reload();}});}
var lastAct=Date.now(),idleT=null,hiddenAt=0;
function lockMs(){return Math.max(5000,(M&&+M.lock>0?+M.lock:5)*60000);}
function act(){lastAct=Date.now();}
function idleCheck(){if(M&&mk&&Date.now()-lastAct>=lockMs())lock('idle');}
function startIdle(){stopIdle();lastAct=Date.now();idleT=setInterval(idleCheck,Math.min(10000,lockMs()/4));}
function stopIdle(){if(idleT)clearInterval(idleT);idleT=null;}
['pointerdown','keydown','touchstart','wheel'].forEach(function(t){document.addEventListener(t,act,{capture:true,passive:true});});
document.addEventListener('visibilitychange',function(){if(document.hidden)hiddenAt=Date.now();else{idleCheck();}});
/* otras pestañas de Firmax */
var chan=null;try{chan=new BroadcastChannel('firmax-cifrado');chan.onmessage=function(e){if(e.data==='lock')lock('bc');};}catch(e){}
/* si otra pestaña activa/desactiva el cifrado o cambia la contraseña, esta deja de escribir y se recarga */
window.addEventListener('storage',function(e){if(e.key!==META&&e.key!==null)return;var nm=readMeta();
  if(!!nm!==!!M||(nm&&M&&nm.salt!==M.salt)){mk=null;pend={};M=nm;location.reload();}else if(nm)M=nm;});
function bc(m){try{if(chan)chan.postMessage(m);}catch(e){}}
/* Al tocar un enlace interno (Inicio, Hoja, Documento) la clave pasa a la página siguiente a través de la MEMORIA
   del service worker (10 s, un solo uso). Abrir la app, recargar o abrir otra pestaña siempre pide la contraseña. */
var swAct=null;
function swc(){return navigator.serviceWorker&&navigator.serviceWorker.controller||swAct;}
/* en la primera visita la página aún no está controlada: se usa el worker activo del registro */
function swFind(){if(swc())return Promise.resolve(swc());if(!navigator.serviceWorker||!navigator.serviceWorker.getRegistration)return Promise.resolve(null);
  return navigator.serviceWorker.getRegistration().then(function(r){swAct=r&&r.active||null;return swAct;},function(){return null;});}
swFind();
function swPut(){var c=swc();if(c&&mk&&M)try{c.postMessage({fx:'put',key:mk,id:M.salt,ttl:10000});}catch(e){}}
var scopeDir=location.pathname.replace(/[^\/]*$/,'');
document.addEventListener('click',function(e){if(!M||!mk||e.defaultPrevented)return;var a=e.target&&e.target.closest&&e.target.closest('a[href]');if(!a||(a.target&&a.target!=='_self')||a.hasAttribute('download'))return;
  try{var u=new URL(a.href,location.href);if(u.origin===location.origin&&u.pathname.indexOf(scopeDir)===0&&/(^|\/)([^\/]*\.html)?$/.test(u.pathname))swPut();}catch(_){}},true);
function swForget(){var c=swc();if(c)try{c.postMessage({fx:'forget'});}catch(e){}}
function swGet(){if(!M||!window.MessageChannel)return Promise.resolve(null);
  return new Promise(function(res){var ch=new MessageChannel(),done=false;var to=setTimeout(function(){if(!done){done=true;res(null);}},600);
    swFind().then(function(c){if(done)return;if(!c){done=true;clearTimeout(to);res(null);return;}
    ch.port1.onmessage=function(e){if(done)return;done=true;clearTimeout(to);res(e.data&&e.data.key||null);};
    try{c.postMessage({fx:'get',id:M.salt},[ch.port2]);}catch(e){done=true;clearTimeout(to);res(null);}});});}

/* ---------- pantalla de desbloqueo ---------- */
var CSS='html.fxLocked body>*:not(.fxGate):not(.i18nPop){visibility:hidden!important}'+
'.fxGate{position:fixed;inset:0;z-index:99990;background:#f3f4f6;display:none;align-items:center;justify-content:center;padding:20px;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#111827;overflow:auto}'+
'.fxGate.open{display:flex}.fxGate .in{background:#fff;border-radius:16px;box-shadow:0 4px 20px rgba(0,0,0,.12);padding:20px;width:100%;max-width:420px}'+
'.fxGate h2{margin:0 0 8px;font-size:22px}.fxGate p{margin:0 0 12px;color:#374151;font-size:15px;line-height:1.4}'+
'.fxIn{width:100%;font:inherit;font-size:18px;padding:12px;border:2px solid #9ca3af;border-radius:10px;margin:6px 0 4px;box-sizing:border-box}'+
'.fxB{display:flex;align-items:center;justify-content:center;width:100%;font:inherit;font-weight:700;font-size:17px;padding:13px 12px;border-radius:12px;border:2px solid #111827;background:#fff;color:#111827;min-height:52px;margin-top:10px;cursor:pointer;box-sizing:border-box}'+
'.fxB.pri{background:#c2410c;border-color:#c2410c;color:#fff}.fxB.gh{border-color:#9ca3af;color:#374151}.fxB.red{border-color:#b91c1c;color:#b91c1c}.fxB:disabled{opacity:.55}'+
'.fxErr{color:#b91c1c;font-weight:700;font-size:15px;min-height:20px;margin-top:4px}.fxOk{color:#166534;font-weight:700;font-size:15px;min-height:20px;margin-top:4px}'+
'.fxNote{font-size:13.5px;color:#6b7280;margin-top:12px;line-height:1.4}.fxTop{display:flex;justify-content:flex-end;margin:-6px -6px 4px}'+
'.fxWarn{background:#fef2f2;border:2px solid #dc2626;color:#7f1d1d;border-radius:10px;padding:10px 12px;font-size:14.5px;line-height:1.4;margin:10px 0;font-weight:600}'+
'.fxLockBtn{flex:none;font:inherit;font-size:19px;line-height:1;width:44px;height:40px;border:2px solid #111827;border-radius:10px;background:#fff;color:#111827;cursor:pointer;padding:0;display:inline-flex;align-items:center;justify-content:center}'+
'.fxM{position:fixed;inset:0;z-index:99980;background:rgba(17,24,39,.6);display:none;align-items:flex-end;justify-content:center;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#111827}'+
'.fxM.open{display:flex}.fxM .sh{background:#fff;width:100%;max-width:640px;border-radius:16px 16px 0 0;padding:16px 16px calc(16px + env(safe-area-inset-bottom));max-height:94vh;overflow:auto;box-sizing:border-box}'+
'.fxM h3{margin:0 0 10px;font-size:20px}.fxM h4{margin:16px 0 4px;font-size:16px}.fxM label{display:block;font-size:14px;font-weight:700;margin:8px 0 2px}'+
'.fxSw{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px;border:2px solid #d1d5db;border-radius:12px;font-weight:700;font-size:17px;cursor:pointer}'+
'.fxSw input{appearance:none;-webkit-appearance:none;width:54px;height:30px;border-radius:999px;background:#d1d5db;position:relative;flex:none;cursor:pointer;margin:0;transition:background .2s}'+
'.fxSw input:before{content:"";position:absolute;top:3px;left:3px;width:24px;height:24px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:left .2s}'+
'.fxSw input:checked{background:#15803d}.fxSw input:checked:before{left:27px}'+
'.fxSt{font-size:14.5px;margin:8px 2px;color:#374151}.fxChk{display:flex;gap:10px;align-items:flex-start;font-size:15px;margin:10px 0;font-weight:600}.fxChk input{width:22px;height:22px;flex:none}'+
'.fxM select{width:100%;font:inherit;font-size:16px;padding:10px;border:1.5px solid #cbd5e1;border-radius:10px;background:#fff}'+
'.fxBusy{position:fixed;inset:0;z-index:99995;background:rgba(255,255,255,.8);display:none;align-items:center;justify-content:center;font:700 19px system-ui,sans-serif}.fxBusy.open{display:flex}';
(function(){var st=document.createElement('style');st.textContent=CSS;document.head.appendChild(st);if(M)document.documentElement.classList.add('fxLocked');})();
function el(h){var d=document.createElement('div');d.innerHTML=h;return d.firstChild;}
var gate=null,busyEl=null;
function busy(on,msg){if(!busyEl){busyEl=el('<div class="fxBusy"></div>');document.body.appendChild(busyEl);}busyEl.textContent=msg||T('cx.busy');busyEl.classList.toggle('open',!!on);}
function gateHTML(){return '<div class="in"><div class="fxTop" id="fxGLang"></div><h2>'+T('cx.gateTitle')+'</h2><p>'+T('cx.gateMsg')+'</p>'+
  '<form id="fxGForm" autocomplete="off"><input class="fxIn" id="fxGPass" type="password" autocomplete="off" placeholder="'+T('cx.passPh')+'" aria-label="'+T('cx.passPh')+'">'+
  '<div class="fxErr" id="fxGErr"></div><button class="fxB pri" id="fxGBtn" type="submit">'+T('cx.unlock')+'</button></form>'+
  '<div class="fxNote">'+T('cx.forgot')+'</div><button class="fxB red" id="fxGWipe" type="button">'+T('cx.wipe')+'</button></div>';}
function renderGate(){if(!gate)return;var v=gate.querySelector('#fxGPass');v=v?v.value:'';gate.innerHTML=gateHTML();gate.querySelector('#fxGPass').value=v;
  if(window.I18N&&I18N.button){var b=I18N.button();b.id='fxGLangBtn';gate.querySelector('#fxGLang').appendChild(b);}
  gate.querySelector('#fxGForm').onsubmit=function(e){e.preventDefault();var p=gate.querySelector('#fxGPass').value,er=gate.querySelector('#fxGErr'),btn=gate.querySelector('#fxGBtn');
    if(!p){gate.querySelector('#fxGPass').focus();return;}
    btn.disabled=true;er.textContent='';btn.textContent=T('cx.checking');
    unlock(p).then(function(){btn.disabled=false;},function(e){btn.disabled=false;btn.textContent=T('cx.unlock');er.textContent=e&&e.wrong?T('cx.wrong'):String(e&&e.message||e);var i=gate.querySelector('#fxGPass');i.select();});};
  gate.querySelector('#fxGWipe').onclick=function(){if(!confirm(T('cx.wipeQ')))return;if(!confirm(T('cx.wipeQ2')))return;wipe();alert(T('cx.wiped'));location.reload();};}
function showGate(){
  if(!document.body){document.addEventListener('DOMContentLoaded',showGate);return;}
  document.documentElement.classList.add('fxLocked');
  if(!gate){gate=el('<div class="fxGate" role="dialog" aria-modal="true"></div>');document.body.appendChild(gate);}
  renderGate();gate.classList.add('open');setTimeout(function(){var i=gate.querySelector('#fxGPass');if(i)i.focus();},50);}
function hideGate(){document.documentElement.classList.remove('fxLocked');if(gate){gate.classList.remove('open');gate.innerHTML='';}}
function lockButton(){var b=document.createElement('button');b.type='button';b.className='fxLockBtn';b.id='fxLockBtn';b.textContent='🔒';
  b.setAttribute('aria-label',T('cx.lockNow'));b.title=T('cx.lockNow');b.style.display=M?'':'none';b.onclick=function(){lock('btn');};return b;}
function refreshLockBtns(){[].forEach.call(document.querySelectorAll('.fxLockBtn'),function(b){b.style.display=M?'':'none';b.title=T('cx.lockNow');b.setAttribute('aria-label',T('cx.lockNow'));});}

/* ---------- ajustes: interruptor “Cifrar datos en este teléfono” ---------- */
var sm=null;
function openSettings(){
  if(!sm){sm=el('<div class="fxM" role="dialog" aria-modal="true"><div class="sh" id="fxSet"></div></div>');document.body.appendChild(sm);
    sm.addEventListener('click',function(e){if(e.target===sm)closeSettings();});}
  renderSettings();sm.classList.add('open');document.body.style.overflow='hidden';}
function closeSettings(){if(sm)sm.classList.remove('open');document.body.style.overflow='';}
function renderSettings(mode){if(!sm)return;var s=sm.querySelector('#fxSet'),on=!!M,h='';
  h+='<h3>'+T('cx.title')+'</h3>';
  h+='<label class="fxSw" for="fxSwIn"><span>'+T('cx.switch')+'</span><input type="checkbox" id="fxSwIn"'+(on?' checked':'')+(subtle?'':' disabled')+'></label>';
  h+='<div class="fxSt" id="fxSt">'+(subtle?(on?T('cx.stOn'):T('cx.stOff')):T('cx.noCrypto'))+'</div>';
  if(mode==='enable'){
    h+='<div class="fxWarn">'+T('cx.warn')+'</div>';
    h+='<label for="fxP1">'+T('cx.pass1')+'</label><input class="fxIn" id="fxP1" type="password" autocomplete="new-password">';
    h+='<label for="fxP2">'+T('cx.pass2')+'</label><input class="fxIn" id="fxP2" type="password" autocomplete="new-password">';
    h+='<label class="fxChk"><input type="checkbox" id="fxAck"><span>'+T('cx.ack')+'</span></label>';
    h+='<div class="fxErr" id="fxErr"></div><button class="fxB pri" id="fxDoEn" type="button">'+T('cx.enable')+'</button><button class="fxB gh" id="fxCancel" type="button">'+T('cancel')+'</button>';
  }else if(mode==='disable'){
    h+='<p class="fxSt">'+T('cx.disableNote')+'</p><label for="fxCur">'+T('cx.cur')+'</label><input class="fxIn" id="fxCur" type="password" autocomplete="off">';
    h+='<div class="fxErr" id="fxErr"></div><button class="fxB pri" id="fxDoDis" type="button">'+T('cx.disable')+'</button><button class="fxB gh" id="fxCancel" type="button">'+T('cancel')+'</button>';
  }else if(on){
    h+='<label for="fxLockSel">'+T('cx.autoLock')+'</label><select id="fxLockSel">'+LOCKS.concat(LOCKS.indexOf(+M.lock)<0?[+M.lock]:[]).map(function(n){return '<option value="'+n+'"'+(+M.lock===n?' selected':'')+'>'+T('cx.min',{n:n})+'</option>';}).join('')+'</select>';
    h+='<button class="fxB" id="fxLockNow" type="button">'+T('cx.lockNow')+'</button>';
    h+='<h4>'+T('cx.change')+'</h4><label for="fxOld">'+T('cx.cur')+'</label><input class="fxIn" id="fxOld" type="password" autocomplete="off">';
    h+='<label for="fxN1">'+T('cx.pass1')+'</label><input class="fxIn" id="fxN1" type="password" autocomplete="new-password"><label for="fxN2">'+T('cx.pass2')+'</label><input class="fxIn" id="fxN2" type="password" autocomplete="new-password">';
    h+='<div class="fxErr" id="fxErr"></div><div class="fxOk" id="fxOkMsg"></div><button class="fxB" id="fxDoCh" type="button">'+T('cx.changeBtn')+'</button>';
    h+='<div class="fxWarn">'+T('cx.warn')+'</div>';
  }else{
    h+='<div class="fxWarn">'+T('cx.warn')+'</div>';
  }
  h+='<div class="fxNote">'+T('cx.what')+'</div><div class="fxNote">'+T('cx.sep')+'</div>';
  if(!mode)h+='<button class="fxB gh" id="fxClose" type="button">'+T('close')+'</button>';
  s.innerHTML=h;
  var q=function(id){return s.querySelector('#'+id);},err=function(m){var e=q('fxErr');if(e)e.textContent=m;};
  q('fxSwIn').onchange=function(){var c=this.checked;this.checked=on;if(c&&!on)renderSettings('enable');else if(!c&&on)renderSettings('disable');};
  if(q('fxCancel'))q('fxCancel').onclick=function(){renderSettings();};
  if(q('fxClose'))q('fxClose').onclick=closeSettings;
  if(q('fxDoEn'))q('fxDoEn').onclick=function(){var a=q('fxP1').value,b=q('fxP2').value;
    if(a.length<MINLEN){err(T('cx.short'));return;}if(a!==b){err(T('cx.mismatch'));return;}if(!q('fxAck').checked){err(T('cx.needAck'));return;}
    busy(true,T('cx.encrypting'));enable(a).then(function(){busy(false);renderSettings();refreshLockBtns();toastish(T('cx.enabled'));},function(e){busy(false);err(String(e&&e.message||e));});};
  if(q('fxDoDis'))q('fxDoDis').onclick=function(){var p=q('fxCur').value;if(!p){q('fxCur').focus();return;}
    busy(true,T('cx.decrypting'));disable(p).then(function(){busy(false);renderSettings();refreshLockBtns();toastish(T('cx.disabled'));},function(e){busy(false);err(e&&e.wrong?T('cx.wrong'):String(e&&e.message||e));});};
  if(q('fxLockSel'))q('fxLockSel').onchange=function(){setLockMin(this.value);startIdle();};
  if(q('fxLockNow'))q('fxLockNow').onclick=function(){closeSettings();lock('btn');};
  if(q('fxDoCh'))q('fxDoCh').onclick=function(){var o=q('fxOld').value,a=q('fxN1').value,b=q('fxN2').value;q('fxOkMsg').textContent='';
    if(!o){q('fxOld').focus();return;}if(a.length<MINLEN){err(T('cx.short'));return;}if(a!==b){err(T('cx.mismatch'));return;}
    busy(true);changePass(o,a).then(function(){busy(false);err('');q('fxOld').value=q('fxN1').value=q('fxN2').value='';q('fxOkMsg').textContent=T('cx.changed');},function(e){busy(false);err(e&&e.wrong?T('cx.wrong'):String(e&&e.message||e));});};
}
function toastish(m){var t=document.getElementById('toast');if(t){t.textContent=m;t.classList.add('show');clearTimeout(t._t);t._t=setTimeout(function(){t.classList.remove('show');},2800);}else{var e=document.getElementById('fxSt');if(e)e.textContent=m;}}
if(window.I18N&&I18N.onChange)I18N.onChange(function(){if(gate&&gate.classList.contains('open'))renderGate();if(sm&&sm.classList.contains('open'))renderSettings();refreshLockBtns();});

/* arranque: si está activado, intentar la clave de la sesión (service worker); si no, pedir la contraseña */
if(M){
  if(!subtle){document.addEventListener('DOMContentLoaded',function(){showGate();var e=gate.querySelector('#fxGErr');if(e)e.textContent=T('cx.noCrypto');});}
  else{var started=false,go=function(){if(started)return;started=true;
      swGet().then(function(k){if(!k)return showGate();var o=parseEnv(M.chk);
        return unseal('chk',o,k).then(function(){return unlockWith(k);},function(){showGate();});}).catch(function(){showGate();});};
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',go);else go();}
}

window.FXV={
  get:get,set:set,remove:remove,
  get on(){return !!M;},get unlocked(){return !M||!!mk;},
  ready:function(f){if(isReady)f();else readyCbs.push(f);},
  onUnlock:function(f){unlockCbs.push(f);},onBeforeLock:function(f){beforeLock.push(f);},
  set keepOnLock(f){keepOnLock=f;},
  onWriteError:null,
  lock:lock,unlock:unlock,enable:enable,disable:disable,changePass:changePass,flush:flush,
  openSettings:openSettings,lockButton:lockButton,
  SENSITIVE:SENS.slice(),BLOB_PREFIX:BLOB,META:META,ITERATIONS:ITER,MIN_LEN:MINLEN
};
})();
