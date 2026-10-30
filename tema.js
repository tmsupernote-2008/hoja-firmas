/* Tema claro / oscuro / automático (mismo código en Field to Office y Firmax).
   Guarda la elección en localStorage ('tema_v1'): 'auto' (sigue al teléfono), 'light' o 'dark'.
   Pone <html data-theme="light|dark" data-theme-mode="auto|light|dark">. Sin red. */
(function(){
  var K='tema_v1',d=document.documentElement,mq=window.matchMedia?window.matchMedia('(prefers-color-scheme: dark)'):null;
  var IC={auto:'🌓',light:'☀️',dark:'🌙'},ORD=['auto','light','dark'];
  var ES={auto:'Automático',light:'Claro',dark:'Oscuro',title:'Tema',autoNote:'sigue al teléfono'};
  function lbl(k){var I=window.I18N;if(I&&I.t){var s=I.t('th.'+k);if(s&&s!=='th.'+k)return s;}return ES[k];}
  function mode(){try{var v=localStorage.getItem(K);return v==='light'||v==='dark'?v:'auto';}catch(e){return 'auto';}}
  function eff(m){return m==='auto'?(mq&&mq.matches?'dark':'light'):m;}
  var btns=[],pop=null,subs=[];
  function apply(){
    var m=mode(),e=eff(m);d.setAttribute('data-theme',e);d.setAttribute('data-theme-mode',m);d.style.colorScheme=e;
    var tc=document.querySelector('meta[name="theme-color"]');if(tc){if(!tc.hasAttribute('data-light'))tc.setAttribute('data-light',tc.content);tc.content=e==='dark'?(tc.getAttribute('data-dark')||'#0b0f14'):tc.getAttribute('data-light');}
    btns.forEach(upd);if(pop)fill();subs.forEach(function(f){try{f(e,m);}catch(x){}});
  }
  function set(m){if(ORD.indexOf(m)<0)m='auto';try{if(m==='auto')localStorage.removeItem(K);else localStorage.setItem(K,m);}catch(e){}cur=m;apply();}
  var cur=mode();
  var _mode=mode;mode=function(){var v=_mode();return v==='auto'&&cur!=='auto'?cur:v;}; // si localStorage no funciona (file://), recuerda en memoria
  function upd(b){var m=mode(),t=lbl('title')+': '+lbl(m);b.querySelector('.ic').textContent=IC[m];b.setAttribute('aria-label',t);b.title=t;b.setAttribute('data-mode',m);}
  function css(){if(document.getElementById('temaCss'))return;var s=document.createElement('style');s.id='temaCss';s.textContent=
    '.temaBtn{flex:none;font:inherit;font-size:20px;line-height:1;width:46px;height:42px;min-height:42px;border-radius:12px;cursor:pointer;padding:0;display:inline-flex;align-items:center;justify-content:center;gap:0;margin:0}'+
    '.temaPop{position:fixed;inset:0;z-index:100001;display:none;background:rgba(10,14,20,.38)}.temaPop.open{display:block}'+
    '.temaPop .in{position:absolute;top:calc(10px + env(safe-area-inset-top));right:10px;width:250px;max-width:calc(100vw - 20px);background:#fff;color:#0f172a;border-radius:16px;box-shadow:0 10px 34px rgba(0,0,0,.35);padding:8px;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}'+
    '.temaPop h4{margin:4px 8px 6px;font-size:14px;color:#64748b;font-weight:700}'+
    '.temaPop .in button{display:flex;align-items:center;gap:12px;width:100%;min-height:52px;font:inherit;font-size:17px;font-weight:650;text-align:left;padding:10px 12px;margin:0 0 6px;border:2px solid #e2e8f0;border-radius:12px;background:#fff;color:#0f172a;cursor:pointer;box-shadow:none;flex:none}'+
    '.temaPop .in button .i{font-size:22px;width:28px;text-align:center}.temaPop .in button small{display:block;font-size:12.5px;font-weight:500;color:#64748b}'+
    '.temaPop .in button.on{border-color:#ff6b00;background:#fff1e6}.temaPop .in button.on:after{content:"✓";margin-left:auto;font-weight:900;color:#e05500}'+
    'html[data-theme=dark] .temaPop .in{background:#171d26;color:#f1f5f9}html[data-theme=dark] .temaPop .in button{background:#1f2733;border-color:#334155;color:#f1f5f9}'+
    'html[data-theme=dark] .temaPop .in button.on{border-color:#ff7a1a;background:#3a210c}html[data-theme=dark] .temaPop h4,html[data-theme=dark] .temaPop .in button small{color:#94a3b8}';
    (document.head||d).appendChild(s);}
  function fill(){var m=mode(),In=pop.firstChild;In.innerHTML='<h4></h4>';In.firstChild.textContent=lbl('title');
    ORD.forEach(function(k){var b=document.createElement('button');b.type='button';b.setAttribute('data-tema',k);if(k===m)b.className='on';
      b.innerHTML='<span class="i"></span><span><span class="n"></span>'+(k==='auto'?'<small></small>':'')+'</span>';
      b.querySelector('.i').textContent=IC[k];b.querySelector('.n').textContent=lbl(k);if(k==='auto')b.querySelector('small').textContent=lbl('autoNote');
      b.onclick=function(ev){ev.stopPropagation();set(k);close();};In.appendChild(b);});}
  function open(){css();if(!pop){pop=document.createElement('div');pop.className='temaPop';pop.setAttribute('role','dialog');pop.innerHTML='<div class="in"></div>';
      pop.onclick=function(e){if(e.target===pop)close();};document.addEventListener('keydown',function(e){if(e.key==='Escape')close();});document.body.appendChild(pop);}
    fill();pop.classList.add('open');var on=pop.querySelector('button.on');if(on)on.focus();}
  function close(){if(pop)pop.classList.remove('open');}
  function button(cls){css();var b=document.createElement('button');b.type='button';b.className='temaBtn'+(cls?' '+cls:'');b.innerHTML='<span class="ic" aria-hidden="true"></span>';
    b.onclick=function(){open();};btns.push(b);upd(b);return b;}
  if(mq){var h=function(){if(mode()==='auto')apply();};if(mq.addEventListener)mq.addEventListener('change',h);else if(mq.addListener)mq.addListener(h);}
  window.addEventListener('storage',function(e){if(e.key===K){cur=_mode();apply();}});
  window.Tema={mode:mode,effective:function(){return eff(mode());},set:set,button:button,open:open,close:close,onChange:function(f){subs.push(f);},refresh:function(){btns.forEach(upd);if(pop&&pop.classList.contains('open'))fill();}};
  apply();
  function mount(){[].forEach.call(document.querySelectorAll('[data-tema-slot]'),function(s){if(!s.querySelector('.temaBtn'))s.appendChild(button(s.getAttribute('data-tema-slot')));});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
})();
