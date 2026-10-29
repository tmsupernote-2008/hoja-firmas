/* Compartir / Enviar – común a hoja.html y documento.html. No envía nada por sí solo:
   abre el menú de compartir del teléfono o la app de correo para que el usuario envíe. */
(function(){
'use strict';
var LS_TO='dwe_mail_to';
var css='.shm{position:fixed;inset:0;background:rgba(17,24,39,.6);z-index:70;display:none;align-items:flex-end;justify-content:center}'+
'.shm.open{display:flex}.shm .sh{background:#fff;width:100%;max-width:640px;border-radius:16px 16px 0 0;padding:14px 14px calc(14px + env(safe-area-inset-bottom));max-height:92vh;overflow:auto;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#111827}'+
'.shm h3{margin:0 0 6px;font-size:19px}.shm .st{font-size:14px;color:#374151;margin:0 0 10px;word-break:break-word}'+
'.shm label{display:block;font-size:14px;font-weight:700;margin:10px 0 4px}.shm input{width:100%;font:inherit;font-size:17px;padding:11px;border:2px solid #9ca3af;border-radius:10px}'+
'.shm .b{display:flex;align-items:center;justify-content:center;width:100%;font:inherit;font-weight:700;font-size:17px;padding:13px 12px;border-radius:12px;border:2px solid #111827;background:#fff;color:#111827;min-height:52px;margin-top:9px;cursor:pointer}'+
'.shm .b.pri{background:#c2410c;border-color:#c2410c;color:#fff}.shm .b.dark{background:#111827;color:#fff}.shm .b.gh{border-color:#9ca3af;color:#374151}.shm .b:disabled{opacity:.5}'+
'.shm .warn{background:#fef3c7;border:1px solid #f59e0b;border-radius:10px;padding:9px 11px;font-size:14px;margin-top:10px;display:none}.shm .note{font-size:13px;color:#6b7280;margin-top:6px}';
var st=document.createElement('style');st.textContent=css;document.head.appendChild(st);
var m=document.createElement('div');m.className='shm';m.innerHTML=
'<div class="sh" role="dialog" aria-modal="true"><h3>Compartir / Enviar PDF</h3>'+
'<p class="st">Asunto: <b id="shSubj"></b><br>Archivo: <span id="shName">preparando…</span></p>'+
'<button class="b pri" id="shShare" disabled>📤 Compartir PDF (Gmail, Outlook, WhatsApp…)</button>'+
'<div class="warn" id="shWarn">Este navegador no permite compartir archivos directamente. Usa “Descargar PDF” y adjúntalo en tu correo o WhatsApp.</div>'+
'<button class="b dark" id="shDl" disabled>⬇️ Descargar PDF</button>'+
'<label for="shTo">Correo de destino (opcional)</label><input id="shTo" type="email" inputmode="email" autocomplete="email" placeholder="oficina@empresa.com">'+
'<button class="b" id="shMail" disabled>✉️ Abrir correo a ese destinatario</button>'+
'<p class="note">El correo se abre <b>sin adjunto</b>: primero se descarga el PDF y tienes que adjuntarlo tú antes de enviar. Nada se envía automáticamente.</p>'+
'<button class="b gh" id="shClose">Cerrar</button></div>';
document.body.appendChild(m);
var $=function(id){return document.getElementById(id);};
var cur=null,file=null,canShare=false;
try{canShare=!!(navigator.canShare&&window.File&&navigator.canShare({files:[new File([new Uint8Array([37])],'t.pdf',{type:'application/pdf'})]}));}catch(e){}
try{$('shTo').value=localStorage.getItem(LS_TO)||'';}catch(e){}
$('shTo').addEventListener('input',function(){try{localStorage.setItem(LS_TO,$('shTo').value.trim());}catch(e){}});
function close(){m.classList.remove('open');document.body.style.overflow='';file=null;}
$('shClose').onclick=close;m.addEventListener('click',function(e){if(e.target===m)close();});
function enable(on){['shShare','shDl','shMail'].forEach(function(id){$(id).disabled=!on;});if(!canShare)$('shShare').disabled=true;}
function download(){
  if(!file)return;var u=URL.createObjectURL(file.blob),a=document.createElement('a');a.href=u;a.download=file.name;a.rel='noopener';
  document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(u);},60000);
}
$('shDl').onclick=function(){download();if(cur&&cur.onDone)cur.onDone();};
$('shShare').onclick=function(){
  if(!file)return;
  var f=new File([file.blob],file.name,{type:'application/pdf'});
  navigator.share({files:[f],title:cur.subject,text:cur.subject+'\n\n'+(cur.body||'Adjunto el PDF.')})
    .then(function(){if(cur&&cur.onDone)cur.onDone();close();})
    .catch(function(e){if(e&&e.name==='AbortError')return;$('shWarn').textContent='No se pudo compartir ('+(e.message||e)+'). Usa “Descargar PDF” y adjúntalo.';$('shWarn').style.display='block';});
};
$('shMail').onclick=function(){
  var to=$('shTo').value.trim();
  if(to&&!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to.split(',')[0].trim())){alert('Revisa el correo de destino.');return;}
  download();
  var body=(cur.body||'')+'\n\n(Adjunta aquí el PDF descargado: '+file.name+')';
  var href='mailto:'+encodeURIComponent(to).replace(/%40/g,'@').replace(/%2C/g,',')+'?subject='+encodeURIComponent(cur.subject)+'&body='+encodeURIComponent(body);
  setTimeout(function(){location.href=href;},700);
};
/* opts: {subject, body, makeFile: ()=>Promise<{blob,name}>, onDone} */
window.DWShare={canShareFiles:canShare,open:function(opts){
  cur=opts;file=null;$('shSubj').textContent=opts.subject;$('shName').textContent='preparando PDF…';
  $('shWarn').style.display=canShare?'none':'block';$('shShare').style.display=canShare?'':'none';
  enable(false);m.classList.add('open');document.body.style.overflow='hidden';
  Promise.resolve().then(opts.makeFile).then(function(f){if(cur!==opts)return;file=f;$('shName').textContent=f.name+' ('+Math.max(1,Math.round(f.blob.size/1024))+' KB)';enable(true);})
    .catch(function(e){$('shName').textContent='Error al generar el PDF: '+(e&&e.message||e);});
}};
})();
