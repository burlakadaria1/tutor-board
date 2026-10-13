import React, {useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {createPortal} from 'react-dom';
import {Stage,Layer,Line,Arrow,Rect,Circle,Shape,Image as KonvaImage,Transformer} from 'react-konva';
import './style.css';
import {createClient} from '@supabase/supabase-js';
const url=import.meta.env.VITE_SUPABASE_URL;
const key=import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase=url&&key?createClient(url,key):null;
const PALETTE=['#000000','#555555','#999999','#FFFFFF','#E53935','#FF9800','#FFEB3B','#43A047','#00ACC1','#1E88E5','#3949AB','#8E24AA','#F06292','#795548','#7CB342'];
const WIDTH=1600, HEIGHT=100000, KEY='tutor-board-v1';
const GRID_ID='00000000-0000-4000-8000-000000000001';
const initial=()=>{try{return JSON.parse(localStorage.getItem(KEY))||[]}catch{return []}};
const VIEW_KEY='tutor-board-viewport-v1';
const savedViewport=()=>{try{const v=JSON.parse(localStorage.getItem(VIEW_KEY));if(v&&Number.isFinite(v.zoom)&&v.zoom>=.25&&v.zoom<=3&&Number.isFinite(v.x)&&Number.isFinite(v.y))return v}catch{}return null};

// Distance between a moving eraser segment and each stroke segment.
const dist2=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const dot=(a,b)=>a.x*b.x+a.y*b.y;
const subtract=(a,b)=>({x:a.x-b.x,y:a.y-b.y});
function pointSegmentDistance(p,a,b){const ab=subtract(b,a);const d=dot(ab,ab);const t=d?Math.max(0,Math.min(1,dot(subtract(p,a),ab)/d)):0;return dist2(p,{x:a.x+t*ab.x,y:a.y+t*ab.y})}
function segmentsIntersect(a,b,c,d){const cross=(u,v)=>u.x*v.y-u.y*v.x;const r=subtract(b,a),q=subtract(d,c),den=cross(r,q);if(Math.abs(den)<1e-9)return false;const t=cross(subtract(c,a),q)/den,u=cross(subtract(c,a),r)/den;return t>=0&&t<=1&&u>=0&&u<=1}
function segmentsDistance(a,b,c,d){return segmentsIntersect(a,b,c,d)?0:Math.min(pointSegmentDistance(a,c,d),pointSegmentDistance(b,c,d),pointSegmentDistance(c,a,b),pointSegmentDistance(d,a,b))}
function imageTouched(item,a,b,radius){
 if(item.type!=='image')return false;
 const left=Math.min(item.x,item.x+item.width)-radius;
 const right=Math.max(item.x,item.x+item.width)+radius;
 const top=Math.min(item.y,item.y+item.height)-radius;
 const bottom=Math.max(item.y,item.y+item.height)+radius;
 // Test the entire movement segment, including when it starts outside the image.
 if(Math.max(a.x,b.x)<left||Math.min(a.x,b.x)>right||Math.max(a.y,b.y)<top||Math.min(a.y,b.y)>bottom)return false;
 if((a.x>=left&&a.x<=right&&a.y>=top&&a.y<=bottom)||(b.x>=left&&b.x<=right&&b.y>=top&&b.y<=bottom))return true;
 const tl={x:left,y:top},tr={x:right,y:top},br={x:right,y:bottom},bl={x:left,y:bottom};
 return segmentsIntersect(a,b,tl,tr)||segmentsIntersect(a,b,tr,br)||segmentsIntersect(a,b,br,bl)||segmentsIntersect(a,b,bl,tl);
}
function strokeTouched(item,a,b,radius){if(!['pen','line','arrow','dashed'].includes(item.type))return false;const pts=item.points||[];const radiusWithStroke=radius+(item.size||1)/2;for(let n=0;n<pts.length;n+=2){const c={x:pts[n],y:pts[n+1]};const d=n+2<pts.length?{x:pts[n+2],y:pts[n+3]}:c;if(segmentsDistance(a,b,c,d)<=radiusWithStroke)return true}return false}
function Board(){
 const initialViewport=useRef(savedViewport()).current;
 const [items,setItems]=useState([]),[tool,setTool]=useState('pen'),[color,setColor]=useState('#222222'),[colorsOpen,setColorsOpen]=useState(false),[colorPopupPos,setColorPopupPos]=useState({top:70,left:0}),[size,setSize]=useState(3),[zoom,setZoom]=useState(()=>initialViewport?.zoom??1),[view,setView]=useState(()=>({x:initialViewport?.x??0,y:initialViewport?.y??0})),[screen,setScreen]=useState({w:innerWidth,h:innerHeight-64}),[selected,setSelected]=useState(null),[history,setHistory]=useState([]),[future,setFuture]=useState([]);
 const [gridSize,setGridSize]=useState(0);
 const eraserSize=12;
 const [eraserCursor,setEraserCursor]=useState(null);
 const erasing=useRef(null);
 const changeGrid=async value=>{
  setGridSize(value);
  if(!supabase)return;
  const {error}=await supabase.from('board_objects').upsert({id:GRID_ID,data:{id:GRID_ID,type:'settings',gridSize:value},updated_at:new Date().toISOString()});
  if(error)alert('Не удалось синхронизировать фон: '+error.message);
 };
 const endpointDrag=useRef(null);
 const stage=useRef(null),active=useRef(null),drag=useRef(null),imageCache=useRef({}),[imageVersion,setImageVersion]=useState(0),transformer=useRef(null),imageNodes=useRef({});
 useEffect(()=>{const update=()=>setScreen({w:innerWidth,h:innerHeight-64});window.addEventListener('resize',update);return()=>window.removeEventListener('resize',update)},[]);
 useEffect(()=>{try{localStorage.setItem(VIEW_KEY,JSON.stringify({zoom,x:view.x,y:view.y}))}catch{}},[zoom,view.x,view.y]);
 useEffect(()=>{try{localStorage.setItem(KEY,JSON.stringify(items))}catch{alert('Хранилище браузера заполнено. Попробуйте уменьшить размер изображений.')}},[items]);
 useEffect(()=>{if(transformer.current){const node=imageNodes.current[selected];transformer.current.nodes(tool==='select'&&node?[node]:[]);transformer.current.getLayer()?.batchDraw()}},[selected,items,tool,imageVersion]);
 useEffect(()=>{items.filter(i=>i.type==='image'&&!imageCache.current[i.id]).forEach(i=>{const img=new window.Image();img.onload=()=>{imageCache.current[i.id]=img;setImageVersion(v=>v+1)};img.src=i.src})},[items]);
 useEffect(()=>{const onKey=e=>{if(e.key==='Escape')setSelected(null)};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey)},[]);
 const itemsRef=useRef([]), ready=useRef(false), pending=useRef(new Set());
 useEffect(()=>{itemsRef.current=items},[items]);
 useEffect(()=>{
  if(!supabase){console.error('Supabase variables missing');return}
  let alive=true;
  const channel=supabase.channel('shared-board').on('postgres_changes',{event:'*',schema:'public',table:'board_objects'},payload=>{
   if(!alive)return;
   const id=payload.new?.id||payload.old?.id;
   if(id===GRID_ID){if(payload.eventType!=='DELETE'){const v=Number(payload.new?.data?.gridSize);if([0,20,40,80].includes(v))setGridSize(v)}return}
   if(!ready.current)return;
   if(pending.current.has(id))return;
   setItems(old=>payload.eventType==='DELETE'?old.filter(i=>i.id!==id):[...old.filter(i=>i.id!==id),payload.new.data]);
  }).subscribe();
  (async()=>{const {data,error}=await supabase.from('board_objects').select('id,data');if(error){console.error(error);return}if(alive){setItems((data||[]).filter(row=>row.id!==GRID_ID).map(row=>row.data));const settings=(data||[]).find(row=>row.id===GRID_ID);if(settings){const v=Number(settings.data?.gridSize);if([0,20,40,80].includes(v))setGridSize(v)}ready.current=true}})();
  return()=>{alive=false;supabase.removeChannel(channel)};
 },[]);
 const syncDiff=async(before,after)=>{
  if(!supabase||!ready.current)return;
  const previous=new Map(before.map(i=>[i.id,i]));
  const next=new Map(after.map(i=>[i.id,i]));
  const deleted=before.filter(i=>!next.has(i.id)).map(i=>i.id);
  const changed=after.filter(i=>JSON.stringify(previous.get(i.id))!==JSON.stringify(i));
  const ids=[...deleted,...changed.map(i=>i.id)];ids.forEach(id=>pending.current.add(id));
  try{
   if(deleted.length){const {error}=await supabase.from('board_objects').delete().in('id',deleted);if(error)throw error}
   if(changed.length){const {error}=await supabase.from('board_objects').upsert(changed.map(i=>({id:i.id,data:i,updated_at:new Date().toISOString()})));if(error)throw error}
  }catch(e){console.error(e);alert('Не удалось синхронизировать изменения: '+e.message)}
  finally{setTimeout(()=>ids.forEach(id=>pending.current.delete(id)),1500)}
 };
 const commit=(next)=>{setHistory(h=>[...h.slice(-39),items]);setFuture([]);setItems(next);syncDiff(items,next)};
 const undo=()=>{if(!history.length)return;setFuture(f=>[items,...f]);setItems(history.at(-1));syncDiff(items,history.at(-1));setHistory(h=>h.slice(0,-1));setSelected(null)};
 const redo=()=>{if(!future.length)return;setHistory(h=>[...h,items]);setItems(future[0]);syncDiff(items,future[0]);setFuture(f=>f.slice(1));setSelected(null)};
 const outsidePan=useRef(null);
 const pointerClient=e=>{const t=e.evt.touches?.[0]||e.evt.changedTouches?.[0]||e.evt;return {x:t.clientX,y:t.clientY}};
 const touchOrPen=e=>e.evt.type?.startsWith('touch')||e.evt.pointerType==='pen';
 const inside=p=>p.x>=0&&p.x<=WIDTH&&p.y>=0&&p.y<=HEIGHT;
 const clampPoint=p=>({x:Math.max(0,Math.min(WIDTH,p.x)),y:Math.max(0,Math.min(HEIGHT,p.y))});
 const point=e=>{const p=stage.current.getPointerPosition();return{x:(p.x-view.x)/zoom,y:(p.y-view.y)/zoom}};
 const eraseAt=p=>{const session=erasing.current;if(!session)return;const prev=session.last;session.last=p;if(!inside(p)){session.last=null;return}if(!prev)return;const removed=[];const remaining=itemsRef.current.filter(i=>{if(strokeTouched(i,prev,p,eraserSize/2)||imageTouched(i,prev,p,eraserSize/2)){removed.push(i.id);return false}return true});if(removed.length){removed.forEach(id=>session.deleted.add(id));itemsRef.current=remaining;setItems(remaining);setSelected(current=>removed.includes(current)?null:current)}};
 const down=e=>{if(e.evt.button===2)return;const p=point(e);if(touchOrPen(e)&&!inside(p)){outsidePan.current={...pointerClient(e),start:view};return}if(tool==='hand'){drag.current={x:e.evt.clientX,y:e.evt.clientY,start:view};return}if(tool==='select'){const id=e.target?.attrs?.itemId;if(id&&itemsRef.current.some(i=>i.id===id&&(i.type==='image'||['line','arrow','dashed'].includes(i.type))))setSelected(id);else if(e.target!==transformer.current&&!e.target?.getParent?.()?.className?.includes('Transformer'))setSelected(null);return}if(tool==='eraser'){if(!inside(p))return;erasing.current={before:[...itemsRef.current],last:p,deleted:new Set()};setEraserCursor(p);eraseAt(p);return}if((['pen','line','arrow','dashed'].includes(tool))&&inside(p)){const id=crypto.randomUUID();active.current={id,type:tool,points:[p.x,p.y,p.x,p.y],color,size};setItems(prev=>[...prev,{...active.current}])}};
 const move=e=>{if(outsidePan.current){const c=pointerClient(e),d=outsidePan.current;setView({x:boundX(d.start.x+c.x-d.x,zoom),y:Math.min(0,d.start.y+c.y-d.y)});return}if(drag.current){setView({x:boundX(drag.current.start.x+e.evt.clientX-drag.current.x,zoom),y:Math.min(0,drag.current.start.y+e.evt.clientY-drag.current.y)});return}const p=point(e);if(tool==='eraser'){setEraserCursor(p);if(erasing.current)eraseAt(p);return}if(!active.current)return;const bounded=clampPoint(p);const a=active.current;a.points=['line','arrow','dashed'].includes(tool)?[a.points[0],a.points[1],bounded.x,bounded.y]:[...a.points,bounded.x,bounded.y];setItems(prev=>prev.map(i=>i.id===a.id?{...a}:i))};
 const up=()=>{outsidePan.current=null;drag.current=null;if(erasing.current){const session=erasing.current;erasing.current=null;if(session.deleted.size){const after=itemsRef.current;setHistory(h=>[...h.slice(-39),session.before]);setFuture([]);syncDiff(session.before,after)}return}const finished=active.current;if(finished){const previous=itemsRef.current.filter(i=>i.id!==finished.id);setHistory(h=>[...h.slice(-39),previous]);setFuture([]);active.current=null;syncDiff(previous,[...previous,{...finished}])}};
 const upload=e=>{const files=[...e.target.files];files.forEach(file=>{if(!file.type.startsWith('image/'))return;const reader=new FileReader();reader.onload=()=>{const img=new window.Image();img.onload=()=>{const ratio=Math.min(1,900/img.width,900/img.height);const c=document.createElement('canvas');c.width=Math.round(img.width*ratio);c.height=Math.round(img.height*ratio);c.getContext('2d').drawImage(img,0,0,c.width,c.height);const p={x:Math.max(0,Math.min(WIDTH-c.width,-view.x/zoom+80)),y:Math.max(0,Math.min(HEIGHT-c.height,-view.y/zoom+80))};const imageId=crypto.randomUUID();setTool('select');setSelected(imageId);setItems(old=>{setHistory(h=>[...h.slice(-39),old]);setFuture([]);const next=[...old,{id:imageId,type:'image',src:c.toDataURL('image/jpeg',.82),x:p.x,y:p.y,width:c.width,height:c.height}];syncDiff(old,next);return next})};img.src=reader.result};reader.readAsDataURL(file)});e.target.value=''};
 const boundX=(x,z)=>WIDTH*z<=screen.w?(screen.w-WIDTH*z)/2:Math.max(screen.w-WIDTH*z,Math.min(0,x));
 const wheel=e=>{e.evt.preventDefault();if(e.evt.ctrlKey||e.evt.metaKey){const old=zoom;const next=Math.max(.25,Math.min(3,old*(e.evt.deltaY>0?.92:1.08)));const p=stage.current.getPointerPosition();setView(v=>({x:boundX(p.x-(p.x-v.x)*next/old,next),y:Math.min(0,p.y-(p.y-v.y)*next/old)}));setZoom(next)}else setView(v=>({x:boundX(v.x-e.evt.deltaX,zoom),y:Math.min(0,v.y-e.evt.deltaY)}))};
 const zoomAtCenter=(factor)=>{const next=Math.max(.25,Math.min(3,zoom*factor));const cx=screen.w/2,cy=screen.h/2;setView(v=>({x:boundX(cx-(cx-v.x)*next/zoom,next),y:Math.min(0,cy-(cy-v.y)*next/zoom)}));setZoom(next)};
 const fitX=()=>{const z=Math.min(1,(screen.w-32)/WIDTH);setZoom(z);setView({x:(screen.w-WIDTH*z)/2,y:0})};
 return <><header><strong>Моя доска</strong><div className="tools"><button className={tool==='pen'?'active':''} onClick={()=>setTool('pen')}>✏️ Ручка</button><button className={tool==='eraser'?'active':''} onClick={()=>setTool('eraser')}>🧽 Ластик</button><button className={tool==='line'?'active':''} onClick={()=>setTool('line')}>╱ Линия</button><button className={tool==='arrow'?'active':''} onClick={()=>setTool('arrow')}>➜ Стрелка</button><button className={tool==='dashed'?'active':''} onClick={()=>setTool('dashed')}>┄ Пунктир</button><button className={tool==='select'?'active':''} onClick={()=>setTool('select')}>↖ Выбор</button><label className="upload">＋ Картинка<input type="file" accept="image/*" multiple onChange={upload} hidden/></label><div className="color-control"><button type="button" className="color-trigger" title="Выбрать цвет" aria-label="Выбрать цвет" aria-expanded={colorsOpen} onClick={e=>{const r=e.currentTarget.getBoundingClientRect();setColorPopupPos({top:r.bottom+8,left:Math.max(8,Math.min(r.left,window.innerWidth-232))});setColorsOpen(v=>!v)}}><span className="current-color" style={{backgroundColor:color}}/></button>{colorsOpen&&createPortal(<div className="color-popover" style={{top:colorPopupPos.top,left:colorPopupPos.left}}><div className="color-grid">{PALETTE.map(c=><button key={c} type="button" title={c} aria-label={'Цвет '+c} aria-pressed={color.toLowerCase()===c.toLowerCase()} className={'color-swatch'+(color.toLowerCase()===c.toLowerCase()?' chosen':'')} style={{backgroundColor:c}} onClick={()=>{setColor(c);setColorsOpen(false)}}/>)}</div><label className="custom-color">Другой цвет <input aria-label="Другой цвет" type="color" value={color} onChange={e=>setColor(e.target.value)}/></label></div>,document.body)}</div>{(['pen','line','arrow','dashed'].includes(tool))&&<input aria-label="Толщина линии" type="range" min="1" max="20" value={size} onChange={e=>setSize(+e.target.value)}/>}<button onClick={undo} disabled={!history.length}>↶</button><button onClick={redo} disabled={!future.length}>↷</button></div></header><div className="workspace"><Stage ref={stage} width={screen.w} height={screen.h} x={view.x} y={view.y} scaleX={zoom} scaleY={zoom} onMouseDown={down} onTouchStart={down} onMouseMove={move} onTouchMove={move} onMouseUp={up} onTouchEnd={up} onMouseLeave={()=>{up();setEraserCursor(null)}} onWheel={wheel} draggable={false}><Layer clipX={0} clipY={0} clipWidth={WIDTH} clipHeight={HEIGHT}><Rect x={0} y={0} width={WIDTH} height={HEIGHT} fill="white" listening={false}/>{gridSize>0&&<Shape listening={false} sceneFunc={(context)=>{const ctx=context._context;const left=Math.max(0,-view.x/zoom),top=Math.max(0,-view.y/zoom),right=Math.min(WIDTH,(screen.w-view.x)/zoom),bottom=Math.min(HEIGHT,(screen.h-view.y)/zoom);if(right<=left||bottom<=top)return;ctx.save();ctx.beginPath();ctx.rect(left,top,right-left,bottom-top);ctx.clip();ctx.beginPath();ctx.strokeStyle='#DDE3EA';ctx.lineWidth=0.8/zoom;const firstX=Math.ceil(left/gridSize)*gridSize;const firstY=Math.ceil(top/gridSize)*gridSize;for(let x=firstX;x<=right;x+=gridSize){ctx.moveTo(x,top);ctx.lineTo(x,bottom)}for(let y=firstY;y<=bottom;y+=gridSize){ctx.moveTo(left,y);ctx.lineTo(right,y)}ctx.stroke();ctx.restore()}}/>}{items.map(i=>i.type==='image'?<KonvaImage key={i.id} itemId={i.id} ref={node=>imageNodes.current[i.id]=node} image={imageCache.current[i.id]} x={i.x} y={i.y} width={i.width} height={i.height} draggable={tool==='select'} onClick={e=>{if(tool==='select'){e.cancelBubble=true;setSelected(i.id)}}} onTap={e=>{if(tool==='select'){e.cancelBubble=true;setSelected(i.id)}}} onDragStart={e=>{e.cancelBubble=true;setSelected(i.id)}} onDragEnd={e=>{e.cancelBubble=true;const x=Math.max(0,Math.min(WIDTH-i.width,e.target.x())),y=Math.max(0,Math.min(HEIGHT-i.height,e.target.y()));e.target.position({x,y});commit(items.map(v=>v.id===i.id?{...v,x,y}:v))}} onTransformEnd={e=>{e.cancelBubble=true;const n=e.target;const width=Math.min(WIDTH,Math.max(10,n.width()*n.scaleX())),height=Math.min(HEIGHT,Math.max(10,n.height()*n.scaleY()));const updated={x:Math.max(0,Math.min(WIDTH-width,n.x())),y:Math.max(0,Math.min(HEIGHT-height,n.y())),width,height};n.scale({x:1,y:1});commit(items.map(v=>v.id===i.id?{...v,...updated}:v))}}/>:React.createElement(i.type==='arrow'?Arrow:Line,{key:i.id,itemId:i.id,points:i.points,stroke:i.color,fill:i.color,strokeWidth:i.size,tension:i.type==='pen'?.3:0,lineCap:'round',lineJoin:'round',dash:i.type==='dashed'?[12,8]:undefined,pointerLength:i.type==='arrow'?Math.max(12,i.size*4):undefined,pointerWidth:i.type==='arrow'?Math.max(10,i.size*3):undefined,hitStrokeWidth:Math.max(20,i.size),draggable:tool==='select'&&['line','arrow','dashed'].includes(i.type),onClick:e=>{if(tool==='select'&&['line','arrow','dashed'].includes(i.type)){e.cancelBubble=true;setSelected(i.id)}},onTap:e=>{if(tool==='select'&&['line','arrow','dashed'].includes(i.type)){e.cancelBubble=true;setSelected(i.id)}},onDragStart:e=>{e.cancelBubble=true;setSelected(i.id)},onDragEnd:e=>{e.cancelBubble=true;const dx=e.target.x(),dy=e.target.y();e.target.position({x:0,y:0});const points=i.points.map((v,k)=>Math.max(0,Math.min(k%2?HEIGHT:WIDTH,v+(k%2?dy:dx))));commit(itemsRef.current.map(v=>v.id===i.id?{...v,points}:v))}}))}{tool==='select'&&items.filter(i=>['line','arrow','dashed'].includes(i.type)&&i.id===selected).flatMap(i=>[0,1].map(end=><Circle key={i.id+'-endpoint-'+end} x={i.points[end*2]} y={i.points[end*2+1]} radius={7/zoom} fill="white" stroke="#2675e8" strokeWidth={2/zoom} draggable onMouseDown={e=>{e.cancelBubble=true}} onTouchStart={e=>{e.cancelBubble=true}} onDragStart={e=>{e.cancelBubble=true;endpointDrag.current={id:i.id,end,before:itemsRef.current}}} onDragMove={e=>{e.cancelBubble=true;const n=e.target,x=Math.max(0,Math.min(WIDTH,n.x())),y=Math.max(0,Math.min(HEIGHT,n.y()));n.position({x,y});setItems(old=>old.map(v=>{if(v.id!==i.id)return v;const points=[...v.points];points[end*2]=x;points[end*2+1]=y;return {...v,points}}))}} onDragEnd={e=>{e.cancelBubble=true;const d=endpointDrag.current;endpointDrag.current=null;if(!d)return;const next=itemsRef.current.map(v=>{if(v.id!==d.id)return v;const points=[...v.points];points[d.end*2]=Math.max(0,Math.min(WIDTH,e.target.x()));points[d.end*2+1]=Math.max(0,Math.min(HEIGHT,e.target.y()));return {...v,points}});setHistory(h=>[...h.slice(-39),d.before]);setFuture([]);setItems(next);syncDiff(d.before,next)}}/>))}<Transformer ref={transformer} onMouseDown={e=>{e.cancelBubble=true}} onTouchStart={e=>{e.cancelBubble=true}} rotateEnabled={false} keepRatio={true} flipEnabled={false} boundBoxFunc={(oldBox,newBox)=>newBox.width<15||newBox.height<15?oldBox:newBox}/></Layer></Stage></div><div className="bottom-controls"><button title="Перемещать доску" aria-label="Перемещать доску" className={tool==='hand'?'active':''} onClick={()=>setTool('hand')}>✋</button><label className="grid-picker">Фон <select aria-label="Фон доски" value={gridSize} onChange={e=>changeGrid(Number(e.target.value))}><option value={0}>Без клеток</option><option value={20}>Мелкая клетка</option><option value={40}>Средняя клетка</option><option value={80}>Крупная клетка</option></select></label><button onClick={fitX}>По ширине</button><button onClick={()=>zoomAtCenter(1/1.2)}>−</button><span>{Math.round(zoom*100)}%</span><button onClick={()=>zoomAtCenter(1.2)}>＋</button></div><footer>Прокрутка — колесо мыши · Масштаб — Ctrl + колесо · Для iPad: инструменты и касания · Общая доска синхронизируется через Supabase</footer></>}
createRoot(document.getElementById('root')).render(<Board/>);
