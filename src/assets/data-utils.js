function inputTime(t){const d=new Date(Math.round(t/1000)*1000);return d.getUTCFullYear()+'-'+pad(d.getUTCMonth()+1)+'-'+pad(d.getUTCDate())+'T'+pad(d.getUTCHours())+':'+pad(d.getUTCMinutes())+':'+pad(d.getUTCSeconds());}

function parseInput(s){const m=s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);return m?Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+(m[6]||0)):NaN;}

function lower(t){let lo=0,hi=data.times.length;while(lo<hi){const m=(lo+hi)>>>1;if(data.times[m]<t)lo=m+1;else hi=m;}return lo;}

function upper(t){let lo=0,hi=data.times.length;while(lo<hi){const m=(lo+hi)>>>1;if(data.times[m]<=t)lo=m+1;else hi=m;}return lo;}

function nearest(t){const i=lower(t);if(!i)return 0;if(i>=data.rows)return data.rows-1;return t-data.times[i-1]<=data.times[i]-t?i-1:i;}

function limits(){const a=data.times[0],b=data.times.at(-1);return [a,b>a?b:a+Math.max(data.cadence,1000)];}

function sizeCanvas(canvas){const r=canvas.getBoundingClientRect(),dpr=Math.min(window.devicePixelRatio||1,2),w=Math.max(1,Math.round(r.width)),h=Math.max(1,Math.round(r.height));if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);return {ctx,w,h};}

function collect(s,lo,hi,target){const result=[];let level=null;const perPixel=(hi-lo+1)/Math.max(target,1);for(const l of s.levels)if(l.block<=perPixel)level=l;for(const [start,end]of data.segments){let a=Math.max(lo,start),b=Math.min(hi,end);if(a>b)continue;result.push(-1);if(!level){for(let j=a;j<=b;j++)result.push(j);}else{let j=a,block=level.block;while(j<=b&&j%block)result.push(j++);while(j+block-1<=b){const k=Math.floor(j/block),mi=level.min[k],ma=level.max[k];if(mi===4294967295)result.push(-1);else if(level.missing[k]){for(let p=j;p<j+block;p++)result.push(p);}else if(mi===ma)result.push(mi);else if(mi<ma)result.push(mi,ma);else result.push(ma,mi);j+=block;}while(j<=b)result.push(j++);}}return result;}

function yRange(s,points){let min=Infinity,max=-Infinity;for(const i of points)if(i>=0&&Number.isFinite(s.values[i])){min=Math.min(min,s.values[i]);max=Math.max(max,s.values[i]);}if(min===Infinity)return [0,1,false];if(min===max){const pad=Math.max(Math.abs(min)*.05,1);return [min-pad,max+pad,true];}const extra=(max-min)*.08;return [min>=0?Math.max(0,min-extra):min-extra,max+extra,true];}

function niceAxis(min,max){const raw=(max-min)/5,base=10**Math.floor(Math.log10(raw)),step=base*([1,2,2.5,5,10].find(n=>n>=raw/base)||10);return [Math.floor(min/step)*step,Math.ceil(max/step)*step,step];}

function timeTicks(a,b,width){const steps=[1000,2000,5000,10000,15000,30000,60000,120000,300000,600000,900000,1800000,3600000,7200000,10800000,21600000,43200000,86400000,172800000,259200000,432000000,604800000,1209600000,2592000000];const desired=(b-a)/Math.max(2,Math.floor(width/145));const step=steps.find(v=>v>=desired)||Math.ceil(desired/2592000000)*2592000000;const ticks=[];for(let t=Math.ceil(a/step)*step;t<=b&&ticks.length<30;t+=step)ticks.push(t);return {ticks,step};}

function chartFraction(c,event){const r=c.canvas.getBoundingClientRect(),g=c.geometry||{left:70,pw:r.width-88};return Math.max(0,Math.min(1,(event.clientX-r.left-g.left)/g.pw));}

function keyNavigation(e){if(!data)return;if(e.key==='ArrowLeft'){pan(-.25);}else if(e.key==='ArrowRight'){pan(.25);}else if(e.key==='+'||e.key==='='){zoom(.5);}else if(e.key==='-'||e.key==='−'){zoom(2);}else if(e.key==='Home'||e.key==='0'){reset();}else return;e.preventDefault();}
