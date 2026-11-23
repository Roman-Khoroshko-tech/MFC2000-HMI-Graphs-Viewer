'use strict';
const $=id=>document.getElementById(id);
const pad=n=>String(n).padStart(2,'0');
const palette={light:['#157568','#b35b1c','#346faf','#ab497b','#7c59ae','#257d92','#7c6b17'],dark:['#62c9b3','#f4ad71','#91baff','#e792bc','#bda0ec','#80cbdc','#d3c16d']};
const locales={uk:'uk-UA',pl:'pl-PL',en:'en-GB'};
let lang='uk';
try{const saved=localStorage.getItem('hmi-language');if(messages[saved])lang=saved;}catch{}
let data=null,worker=null,view=[0,1],hover=-1,charts=[],drawPending=false,drag=null,overviewDrag=null,dragDepth=0,errorState=null,progressState=null;

function tr(key,args={}){const text=messages[lang][key]??messages.uk[key]??key;return String(text).replace(/\{(\w+)\}/g,(_,k)=>args[k]??'');}
function num(v){return v.toLocaleString(locales[lang]);}
function formatValue(v){return Number.isFinite(v)?v.toLocaleString(locales[lang],{maximumFractionDigits:3}):'—';}
function compact(v){if(!Number.isFinite(v))return '—';if(Math.abs(v)>=1e7||Math.abs(v)>0&&Math.abs(v)<.0001)return v.toExponential(1);return v.toLocaleString(locales[lang],{maximumFractionDigits:Math.abs(v)<1?5:3});}
// The HMI date has no timezone. UTC accessors preserve its wall-clock time.
function formatTime(t,withSeconds=true){const d=new Date(t);return pad(d.getUTCDate())+'.'+pad(d.getUTCMonth()+1)+'.'+d.getUTCFullYear()+' '+pad(d.getUTCHours())+':'+pad(d.getUTCMinutes())+(withSeconds?':'+pad(d.getUTCSeconds()):'');}
function element(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;}
function titleInfo(name){const clean=name.replace(/\((float|double|int|integer)\)/gi,'').trim(),unit=(clean.match(/\[([^\]]+)\]/)||[])[1]||'',base=clean.replace(/\s*\[[^\]]+\]/g,'').trim();return {label:messages[lang].signalNames[base]||base,unit};}
function showError(key=null,args={}){errorState=key?{key,args}:null;$('error').textContent=key?tr(key,args):'';$('error').hidden=!key;}
function renderProgress(){if(progressState){const args={...progressState.args};if(typeof args.count==='number')args.count=num(args.count);$('loadingText').textContent=tr(progressState.key,args);}}
function renderWarnings(){if(!data)return;const result=[];if(data.skipped)result.push(tr('warnSkipped',{count:num(data.skipped)}));if(data.missing)result.push(tr('warnMissing'));if(data.sorted)result.push(tr('warnSort'));if(data.duplicates)result.push(tr('warnDuplicates',{count:num(data.duplicates)}));if(data.ignored.length)result.push(tr('warnIgnored',{names:data.ignored.join(', ')}));$('warnings').textContent=result.join(' ');$('warnings').hidden=!result.length;}

function applyLanguage(){
 document.documentElement.lang=lang;document.title='MFC2000 HMI Graphs Viewer';$('languageBtn').textContent=lang.toUpperCase();
 for(const button of document.querySelectorAll('[data-language]'))button.setAttribute('aria-checked',String(button.dataset.language===lang));
 for(const e of document.querySelectorAll('[data-i18n]'))e.textContent=tr(e.dataset.i18n);
 for(const e of document.querySelectorAll('[data-i18n-aria]'))e.setAttribute('aria-label',tr(e.dataset.i18nAria));
 for(const e of document.querySelectorAll('[data-i18n-title]'))e.title=tr(e.dataset.i18nTitle);
 if(errorState)showError(errorState.key,errorState.args);renderProgress();
 if(data){$('fileMeta').textContent=tr('fileMeta',{rows:num(data.rows),signals:num(data.series.length)});renderWarnings();for(const c of charts)translateChart(c);updateControls();}
 updateHover();scheduleDraw();
}

function setView(a,b){
 if(!data||!Number.isFinite(a)||!Number.isFinite(b)||b<=a)return;
 const [min,max]=limits(),full=max-min,minSpan=Math.min(full,Math.max(1000,data.cadence*2));
 const span=Math.max(minSpan,Math.min(full,b-a));a=Math.max(min,Math.min(max-span,a));view=[a,a+span];hover=-1;
 updateControls();updateHover();scheduleDraw();
}
function zoom(factor,anchor=.5){if(!data)return;const span=view[1]-view[0],t=view[0]+span*anchor,newSpan=span*factor;setView(t-newSpan*anchor,t+newSpan*(1-anchor));}
function pan(fraction){if(!data)return;const s=(view[1]-view[0])*fraction;setView(view[0]+s,view[1]+s);}
function reset(){if(data)setView(...limits());}
function updateControls(){
 const [min,max]=limits();$('rangeLabel').textContent=formatTime(view[0],false)+' — '+formatTime(view[1],false);
 $('fromInput').value=inputTime(view[0]);$('toInput').value=inputTime(view[1]);$('fromInput').min=$('toInput').min=inputTime(min);$('fromInput').max=$('toInput').max=inputTime(max);
 $('prevBtn').disabled=view[0]<=min;$('nextBtn').disabled=view[1]>=max;$('zoomOutBtn').disabled=view[1]-view[0]>=max-min;
 for(const b of document.querySelectorAll('.preset'))b.setAttribute('aria-pressed',String(Math.abs((view[1]-view[0])-Number(b.dataset.span))<1000));
}

function scaleInputValue(v){return Number(v.toPrecision(12)).toString();}
function setScaleError(c,key=null){c.errorKey=key;c.scaleError.textContent=key?tr(key):'';c.scaleError.hidden=!key;c.minInput.setAttribute('aria-invalid',String(!!key));c.maxInput.setAttribute('aria-invalid',String(!!key));}
function syncScaleControls(c,updateInputs=false){
 c.autoInput.checked=c.autoY;
 c.minInput.disabled=c.maxInput.disabled=c.applyButton.disabled=c.autoY;
 c.mode.textContent=tr(c.autoY?'autoMode':'manualMode');
 if(updateInputs&&c.yRange){c.minInput.value=scaleInputValue(c.yRange[0]);c.maxInput.value=scaleInputValue(c.yRange[1]);}
}
function freezeY(c){if(c.autoY){drawChart(c);c.autoY=false;c.manualRange=[...c.yRange];}setScaleError(c);syncScaleControls(c,true);}
function zoomY(c,factor){
 freezeY(c);const [min,max]=c.manualRange,center=min/2+max/2,half=(max-min)*factor/2;
 const a=center-half,b=center+half;if(!validY(a,b))return;
 c.manualRange=[a,b];c.yRange=[a,b];syncScaleControls(c,true);scheduleDraw();
}
function validY(a,b){const span=b-a;return Number.isFinite(a)&&Number.isFinite(b)&&b>a&&Number.isFinite(span)&&span>Math.max(Math.abs(a),Math.abs(b),1)*Number.EPSILON*32;}
function readScaleInput(input){const value=input.value.trim().replace(',','.');return value?Number(value):NaN;}
function createScaleControls(c){
 const form=element('form','y-controls');form.noValidate=true;
 const label=element('label','et-check'),auto=element('input');auto.type='checkbox';auto.checked=true;const autoText=element('span');label.append(auto,autoText);
 const fields=element('div','y-fields');
 function bound(which){const l=element('label','et-field'),text=element('span'),input=element('input');input.type='text';input.inputMode='decimal';input.autocomplete='off';input.spellcheck=false;input.required=true;input.dataset.bound=which;input.setAttribute('aria-describedby','y-error-'+c.index);l.append(text,input);fields.append(l);return {input,text};}
 const min=bound('min'),max=bound('max'),apply=element('button','et-button');apply.type='submit';fields.append(apply);
 const plus=element('button','et-button y-zoom','Y+'),minus=element('button','et-button y-zoom','Y−');plus.type=minus.type='button';fields.append(plus,minus);
 const mode=element('span','y-mode');form.append(label,fields,mode);
 const error=element('p','y-error');error.id='y-error-'+c.index;error.hidden=true;error.setAttribute('role','alert');
 Object.assign(c,{scaleForm:form,autoInput:auto,autoText,minInput:min.input,maxInput:max.input,minText:min.text,maxText:max.text,applyButton:apply,plusButton:plus,minusButton:minus,mode,scaleError:error,errorKey:null});
 auto.addEventListener('change',()=>{if(auto.checked){c.autoY=true;setScaleError(c);syncScaleControls(c);scheduleDraw();}else{freezeY(c);scheduleDraw();}});
 form.addEventListener('submit',e=>{e.preventDefault();if(c.autoY)return;const a=readScaleInput(c.minInput),b=readScaleInput(c.maxInput);if(!validY(a,b)){setScaleError(c,'yInvalid');(Number.isFinite(a)?c.maxInput:c.minInput).focus();return;}c.manualRange=[a,b];c.yRange=[a,b];setScaleError(c);syncScaleControls(c,true);scheduleDraw();});
 plus.addEventListener('click',()=>zoomY(c,.5));minus.addEventListener('click',()=>zoomY(c,2));
 return [form,error];
}
function translateChart(c){
 Object.assign(c.series,titleInfo(c.series.name));const s=c.series,display=s.label+(s.unit?' · '+s.unit:'');
 c.title.textContent=c.signalLabel.textContent=display;c.readingLabel.textContent=s.label;
 c.canvas.setAttribute('aria-label',tr('graphAria',{signal:s.label}));
 c.autoText.textContent=tr('autoY');c.autoInput.setAttribute('aria-label',tr('autoYAria',{signal:s.label}));
 c.minText.textContent=tr('min');c.maxText.textContent=tr('max');c.applyButton.textContent=tr('apply');
 c.minInput.setAttribute('aria-label',tr('yMinAria',{signal:s.label}));c.maxInput.setAttribute('aria-label',tr('yMaxAria',{signal:s.label}));
 for(const [button,key]of[[c.plusButton,'yZoomIn'],[c.minusButton,'yZoomOut']]){button.title=tr(key);button.setAttribute('aria-label',tr(key));}
 syncScaleControls(c);if(c.errorKey)setScaleError(c,c.errorKey);
}
function mountData(d){
 data=d;charts=[];hover=-1;$('signals').replaceChildren();$('charts').replaceChildren();$('readings').replaceChildren();$('fileName').textContent=d.fileName;
 d.series.forEach((s,i)=>{
  Object.assign(s,titleInfo(s.name),{visible:true,colorIndex:i});
  const label=element('label','signal'),check=element('input');check.type='checkbox';check.checked=true;check.dataset.signal=i;
  const dot=element('i','signal-color'),text=element('span','signal-text'),signalLabel=element('span','signal-label');text.append(signalLabel,element('span','signal-source',s.name));label.append(check,dot,text);$('signals').append(label);
  const card=element('article','chart-card et-panel'),head=element('div','chart-heading'),titleWrap=element('div','chart-title'),color=element('i'),title=element('h2');titleWrap.append(color,title);const output=element('output');head.append(titleWrap,output);
  const canvas=element('canvas','chart-canvas');canvas.tabIndex=0;canvas.setAttribute('role','img');
  const reading=element('div','reading'),readingLabel=element('span'),readingValue=element('strong','','—');reading.append(readingLabel,readingValue);$('readings').append(reading);
  const c={index:i,series:s,card,canvas,title,output,readingLabel,readingValue,signalLabel,dot,color,autoY:true,manualRange:null,yRange:[0,1],geometry:null};
  card.append(head,...createScaleControls(c),canvas);$('charts').append(card);charts.push(c);translateChart(c);bindChart(c);
  check.addEventListener('change',()=>{s.visible=check.checked;card.hidden=reading.hidden=!s.visible;$('noSignals').hidden=data.series.some(x=>x.visible);scheduleDraw();});
 });
 $('welcome').hidden=true;$('workspace').hidden=false;$('noSignals').hidden=true;applyLanguage();reset();
}
async function loadFile(file){
 if(!file)return;showError();worker?.terminate();$('loading').hidden=false;progressState={key:'progressRead',args:{file:file.name}};renderProgress();
 const url=URL.createObjectURL(new Blob(['('+workerMain.toString()+')()'],{type:'text/javascript'}));let active;
 try{active=worker=new Worker(url);}catch{URL.revokeObjectURL(url);$('loading').hidden=true;showError('errorWorker');return;}URL.revokeObjectURL(url);
 active.onmessage=e=>{if(worker!==active)return;if(e.data.progress){progressState={key:e.data.progress,args:e.data.args||{}};renderProgress();}else{active.terminate();worker=null;$('loading').hidden=true;if(e.data.error)showError(messages.uk[e.data.error]?e.data.error:'errorRead');else mountData(e.data.data);}};
 active.onerror=()=>{if(worker!==active)return;$('loading').hidden=true;active.terminate();worker=null;showError('errorRead');};active.postMessage(file);
}

function paintTheme(){const css=getComputedStyle(document.documentElement),dark=document.documentElement.dataset.theme==='dark';return {grid:css.getPropertyValue('--et-border').trim(),muted:css.getPropertyValue('--et-muted').trim(),bg:css.getPropertyValue('--et-bg').trim(),surface:css.getPropertyValue('--et-surface').trim(),accent:css.getPropertyValue('--et-accent').trim(),onAccent:css.getPropertyValue('--et-on-accent').trim(),soft:css.getPropertyValue('--et-soft').trim(),colors:palette[dark?'dark':'light']};}
function signalColor(s,theme){return theme.colors[s.colorIndex%theme.colors.length];}
function drawChart(c){
 const theme=paintTheme(),color=signalColor(c.series,theme);c.dot.style.background=c.color.style.background=color;
 if(c.card.hidden)return;
 const {ctx,w,h}=sizeCanvas(c.canvas),left=w<450?58:76,right=20,top=15,bottom=48,pw=w-left-right,ph=h-top-bottom;if(pw<20)return;
 const lo=Math.max(0,lower(view[0])-1),hi=Math.min(data.rows-1,upper(view[1])),points=collect(c.series,lo,hi,pw),visible=points.filter(i=>i>=0&&data.times[i]>=view[0]&&data.times[i]<=view[1]);
 const [rawMin,rawMax,hasData]=yRange(c.series,visible);
 const autoRange=niceAxis(rawMin,rawMax),range=c.autoY?autoRange:(c.manualRange||autoRange),min=range[0],max=range[1];
 c.yRange=[min,max];if(c.autoY)syncScaleControls(c,true);
 const yStep=c.autoY?autoRange[2]:niceAxis(min,max)[2];
 const x=t=>left+(t-view[0])/(view[1]-view[0])*pw,y=v=>top+(max-v)/(max-min)*ph;
 ctx.font='11px "Segoe UI",Arial';ctx.lineWidth=1;ctx.textBaseline='middle';
 const first=Math.ceil((min-yStep*1e-9)/yStep)*yStep;
 for(let i=0;i<20;i++){const val=first+yStep*i;if(val>max+yStep*1e-9)break;const yp=y(val);ctx.strokeStyle=theme.grid;ctx.beginPath();ctx.moveTo(left,yp);ctx.lineTo(w-right,yp);ctx.stroke();ctx.fillStyle=theme.muted;ctx.textAlign='right';ctx.fillText(compact(Math.abs(val)<yStep*1e-9?0:val),left-10,yp);}
 const {ticks,step}=timeTicks(...view,pw);
 for(const t of ticks){const xp=x(t);ctx.strokeStyle=theme.grid;ctx.beginPath();ctx.moveTo(xp,top);ctx.lineTo(xp,top+ph);ctx.stroke();const d=new Date(t);ctx.fillStyle=theme.muted;ctx.textAlign=xp>w-right-40?'right':xp<left+40?'left':'center';const time=pad(d.getUTCHours())+':'+pad(d.getUTCMinutes())+(step<60000?':'+pad(d.getUTCSeconds()):'');ctx.fillText(time,xp,top+ph+17);ctx.font='10px "Segoe UI",Arial';ctx.fillText(pad(d.getUTCDate())+'.'+pad(d.getUTCMonth()+1)+'.'+d.getUTCFullYear(),xp,top+ph+32);ctx.font='11px "Segoe UI",Arial';}
 ctx.save();ctx.beginPath();ctx.rect(left,top,pw,ph);ctx.clip();ctx.strokeStyle=color;ctx.lineWidth=1.4;ctx.lineJoin='round';ctx.beginPath();let pen=false;
 for(const i of points){if(i<0||!Number.isFinite(c.series.values[i])){pen=false;continue;}const xp=x(data.times[i]),yp=y(c.series.values[i]);if(pen)ctx.lineTo(xp,yp);else ctx.moveTo(xp,yp);pen=true;}ctx.stroke();
 if(data.rows===1&&hasData){ctx.fillStyle=color;ctx.beginPath();ctx.arc(x(data.times[0]),y(c.series.values[0]),3,0,Math.PI*2);ctx.fill();}
 if(hover>=0&&data.times[hover]>=view[0]&&data.times[hover]<=view[1]){const xp=x(data.times[hover]),val=c.series.values[hover];ctx.strokeStyle=theme.muted;ctx.lineWidth=1;ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(xp,top);ctx.lineTo(xp,top+ph);ctx.stroke();ctx.setLineDash([]);if(Number.isFinite(val)){ctx.fillStyle=color;ctx.beginPath();ctx.arc(xp,y(val),3.4,0,Math.PI*2);ctx.fill();}}
 ctx.restore();if(!hasData){ctx.fillStyle=theme.muted;ctx.textAlign='center';ctx.fillText(tr('noData'),left+pw/2,top+ph/2);}c.geometry={left,pw};
}
function drawOverview(){
 const theme=paintTheme(),{ctx,w,h}=sizeCanvas($('overview')),left=2,right=2,pw=w-left-right,[a,b]=limits(),x=t=>left+(t-a)/(b-a)*pw;
 const s=data.series.find(s=>s.visible)||data.series[0],points=collect(s,0,data.rows-1,pw),[min,max]=yRange(s,points),y=v=>8+(max-v)/(max-min)*(h-16);
 ctx.fillStyle=theme.bg;ctx.fillRect(left,4,pw,h-8);ctx.save();ctx.beginPath();ctx.rect(left,4,pw,h-8);ctx.clip();ctx.strokeStyle=theme.muted;ctx.lineWidth=1;ctx.beginPath();let pen=false;
 for(const i of points){if(i<0||!Number.isFinite(s.values[i])){pen=false;continue;}if(pen)ctx.lineTo(x(data.times[i]),y(s.values[i]));else ctx.moveTo(x(data.times[i]),y(s.values[i]));pen=true;}ctx.stroke();
 const xa=x(view[0]),xb=x(view[1]);ctx.globalAlpha=.72;ctx.fillStyle=theme.surface;ctx.fillRect(left,4,xa-left,h-8);ctx.fillRect(xb,4,w-right-xb,h-8);ctx.globalAlpha=.13;ctx.fillStyle=theme.accent;ctx.fillRect(xa,4,xb-xa,h-8);ctx.globalAlpha=1;ctx.strokeStyle=theme.accent;ctx.strokeRect(xa,4,Math.max(1,xb-xa),h-8);
 for(const xx of[xa,xb]){ctx.fillStyle=theme.accent;ctx.fillRect(xx-3,h/2-10,6,20);ctx.fillStyle=theme.onAccent;ctx.fillRect(xx-.5,h/2-6,1,12);}ctx.restore();
}
function scheduleDraw(){if(drawPending||!data)return;drawPending=true;requestAnimationFrame(()=>{drawPending=false;for(const c of charts)drawChart(c);drawOverview();});}
function updateHover(){
 $('cursorTime').textContent=hover>=0&&data?formatTime(data.times[hover]):tr('cursorHint');if(!data)return;
 for(const c of charts){const s=c.series,val=hover>=0?s.values[hover]:NaN;const text=hover>=0?formatValue(val)+(s.unit?' '+s.unit:''):'';c.output.textContent=text;c.readingValue.textContent=text||'—';}
}
function setHover(t){const i=nearest(t);hover=Math.abs(data.times[i]-t)>data.gapLimit&&data.times[i]!==t?-1:i;updateHover();scheduleDraw();}
function bindChart(c){
 const canvas=c.canvas;
 canvas.addEventListener('wheel',e=>{e.preventDefault();zoom(Math.exp(Math.max(-250,Math.min(250,e.deltaY))*.003),chartFraction(c,e));},{passive:false});
 canvas.addEventListener('dblclick',reset);canvas.addEventListener('keydown',keyNavigation);
 canvas.addEventListener('pointerdown',e=>{if(e.button!==0)return;canvas.setPointerCapture(e.pointerId);drag={id:e.pointerId,x:e.clientX,view:view.slice(),width:c.geometry?.pw||canvas.clientWidth,moved:false};canvas.style.cursor='grabbing';});
 canvas.addEventListener('pointermove',e=>{if(drag&&drag.id===e.pointerId){if(Math.abs(drag.x-e.clientX)>3)drag.moved=true;const shift=(drag.x-e.clientX)/drag.width*(drag.view[1]-drag.view[0]);if(drag.moved)setView(drag.view[0]+shift,drag.view[1]+shift);}else setHover(view[0]+chartFraction(c,e)*(view[1]-view[0]));});
 canvas.addEventListener('pointerup',e=>{if(drag&&!drag.moved)setHover(view[0]+chartFraction(c,e)*(view[1]-view[0]));drag=null;canvas.style.cursor='crosshair';});
 canvas.addEventListener('pointercancel',()=>{drag=null;canvas.style.cursor='crosshair';});
 canvas.addEventListener('pointerleave',e=>{if(!drag&&e.pointerType!=='touch'){hover=-1;updateHover();scheduleDraw();}});
}

$('overview').addEventListener('pointerdown',e=>{
 if(!data||e.button!==0)return;const r=e.currentTarget.getBoundingClientRect(),fraction=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),[a,b]=limits(),t=a+fraction*(b-a),xa=(view[0]-a)/(b-a)*r.width,xb=(view[1]-a)/(b-a)*r.width,px=e.clientX-r.left;
 const mode=Math.abs(px-xa)<9?'left':Math.abs(px-xb)<9?'right':'move';if(t<view[0]||t>view[1]){const span=view[1]-view[0];setView(t-span/2,t+span/2);}overviewDrag={mode,x:e.clientX,view:view.slice(),scale:(b-a)/r.width};e.currentTarget.setPointerCapture(e.pointerId);
});
$('overview').addEventListener('pointermove',e=>{if(!overviewDrag)return;const d=(e.clientX-overviewDrag.x)*overviewDrag.scale,[a,b]=overviewDrag.view,minSpan=Math.max(1000,data.cadence*2);if(overviewDrag.mode==='left')setView(Math.max(limits()[0],Math.min(a+d,b-minSpan)),b);else if(overviewDrag.mode==='right')setView(a,Math.min(limits()[1],Math.max(b+d,a+minSpan)));else setView(a+d,b+d);});
for(const type of['pointerup','pointercancel'])$('overview').addEventListener(type,()=>overviewDrag=null);
$('overview').addEventListener('dblclick',reset);$('overview').addEventListener('keydown',keyNavigation);
for(const id of['openBtn','chooseBtn'])$(id).addEventListener('click',()=>$('fileInput').click());
$('fileInput').addEventListener('change',e=>{loadFile(e.target.files[0]);e.target.value='';});
$('helpBtn').addEventListener('click',()=>$('help').showModal());$('closeHelp').addEventListener('click',()=>$('help').close());
$('resetBtn').addEventListener('click',reset);$('zoomInBtn').addEventListener('click',()=>zoom(.5));$('zoomOutBtn').addEventListener('click',()=>zoom(2));$('prevBtn').addEventListener('click',()=>pan(-.8));$('nextBtn').addEventListener('click',()=>pan(.8));
for(const b of document.querySelectorAll('.preset'))b.addEventListener('click',()=>{const span=Number(b.dataset.span),center=hover>=0?data.times[hover]:(view[0]+view[1])/2;setView(center-span/2,center+span/2);});
$('allBtn').addEventListener('click',()=>{for(const input of $('signals').querySelectorAll('input')){input.checked=true;input.dispatchEvent(new Event('change'));}});
$('rangeForm').addEventListener('submit',e=>{e.preventDefault();const a=parseInput($('fromInput').value),b=parseInput($('toInput').value);if(!Number.isFinite(a)||!Number.isFinite(b)||a>=b){showError('errorRange');return;}showError();setView(a,b);});
function closeLanguageMenu(restoreFocus=false){$('languageMenu').hidden=true;$('languageBtn').setAttribute('aria-expanded','false');if(restoreFocus)$('languageBtn').focus();}
function openLanguageMenu(){const menu=$('languageMenu');menu.hidden=false;$('languageBtn').setAttribute('aria-expanded','true');menu.querySelector('[aria-checked="true"]').focus();}
$('languageBtn').addEventListener('click',()=>{if($('languageMenu').hidden)openLanguageMenu();else closeLanguageMenu(true);});
$('languageBtn').addEventListener('keydown',e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();openLanguageMenu();}});
$('languageMenu').addEventListener('click',e=>{const button=e.target.closest('[data-language]');if(!button)return;lang=button.dataset.language;try{localStorage.setItem('hmi-language',lang);}catch{}applyLanguage();closeLanguageMenu(true);});
$('languageMenu').addEventListener('keydown',e=>{const items=[...e.currentTarget.querySelectorAll('[data-language]')],index=items.indexOf(document.activeElement);if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();let next=e.key==='Home'?0:e.key==='End'?items.length-1:(index+(e.key==='ArrowDown'?1:-1)+items.length)%items.length;items[next].focus();}else if(e.key==='Escape'){e.preventDefault();closeLanguageMenu(true);}else if(e.key==='Tab')closeLanguageMenu();});
document.addEventListener('click',e=>{if(!e.target.closest('.language-picker'))closeLanguageMenu();});
document.addEventListener('focusin',e=>{if(!e.target.closest('.language-picker'))closeLanguageMenu();});
new MutationObserver(scheduleDraw).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
window.addEventListener('resize',scheduleDraw);
document.addEventListener('dragenter',e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();dragDepth++;$('dragOverlay').hidden=false;}});
document.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();e.dataTransfer.dropEffect='copy';}});
document.addEventListener('dragleave',e=>{e.preventDefault();dragDepth=Math.max(0,dragDepth-1);if(!dragDepth)$('dragOverlay').hidden=true;});
document.addEventListener('drop',e=>{e.preventDefault();dragDepth=0;$('dragOverlay').hidden=true;if(e.dataTransfer.files.length)loadFile(e.dataTransfer.files[0]);});
applyLanguage();
// Read-only diagnostics used by regression checks.
window.HMIApp={inspect:()=>data?({rows:data.rows,language:lang,theme:document.documentElement.dataset.theme,series:charts.map(c=>({name:c.series.name,label:c.series.label,visible:c.series.visible,autoY:c.autoY,yRange:c.yRange,manualRange:c.manualRange})),first:formatTime(data.times[0]),last:formatTime(data.times.at(-1)),view:view.map(t=>formatTime(t)),span:view[1]-view[0],skipped:data.skipped,gaps:data.gaps,hover:hover>=0?{time:formatTime(data.times[hover]),values:data.series.map(s=>s.values[hover])}:null}):null};
