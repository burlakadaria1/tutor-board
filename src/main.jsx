import React, {useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Stage,Layer,Line,Rect,Image as KonvaImage,Transformer} from 'react-konva';
import './style.css';
import {createClient} from '@supabase/supabase-js';
const url=import.meta.env.VITE_SUPABASE_URL;
const key=import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase=url&&key?createClient(url,key):null;
const WIDTH=1600, HEIGHT=100000, KEY='tutor-board-v1';
const initial=()=>{try{return JSON.parse(localStorage.getItem(KEY))||[]}catch{return []}};
function Board(){
 const [items,setItems]=useState([]),[tool,setTool]=useState('pen'),[color,setColor]=useState('#222222'),[size,setSize]=useState(3),[zoom,setZoom]=useState(1),[view,setView]=useState({x:0,y:0}),[screen,setScreen]=useState({w:innerWidth,h:innerHeight-64}),[selected,setSelected]=useState(null),[history,setHistory]=useState([]),[future,setFuture]=useState([]);
 const stage=useRef(null),active=useRef(null),drag=useRef(null),imageCache=useRef({}),[imageVersion,setImageVersion]=useState(0),transformer=useRef(null),imageNodes=useRef({});
 useEffect(()=>{const update=()=>setScreen({w:innerWidth,h:innerHeight-64});window.addEventListener('resize',update);return()=>window.removeEventListener('resize',update)},[]);
 useEffect(()=>{try{localStorage.setItem(KEY,JSON.stringify(items))}catch{alert('Хранилище браузера заполнено. Попробуйте уменьшить размер изображений.')}},[items]);
 useEffect(()=>{if(transformer.current){const node=imageNodes.current[selected];transformer.current.nodes(node?[node]:[]);transformer.current.getLayer()?.batchDraw()}},[selected,items]);
 useEffect(()=>{items.filter(i=>i.type==='image'&&!imageCache.current[i.id]).forEach(i=>{const img=new window.Image();img.onload=()=>{imageCache.current[i.id]=img;setImageVersion(v=>v+1)};img.src=i.src})},[items]);
 useEffect(()=>{const onKey=e=>{if(!selected||tool!=='select')return;if(e.key==='Delete'||e.key==='Backspace'){if(['INPUT','TEXTAREA'].includes(document.activeElement?.tagName))return;e.preventDefault();commit(items.filter(i=>i.id!==selected));setSelected(null)}else if(e.key==='Escape'){setSelected(null)}};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey)},[selected,tool,items]);
 const itemsRef=useRef([]), ready=useRef(false), pending=useRef(new Set());
 useEffect(()=>{itemsRef.current=items},[items]);
 useEffect(()=>{
  if(!supabase){console.error('Supabase variables missing');return}
  let alive=true;
  const channel=supabase.channel('shared-board').on('postgres_changes',{event:'*',schema:'public',table:'board_objects'},payload=>{
   if(!alive||!ready.current)return;
   const id=payload.new?.id||payload.old?.id;
   if(pending.current.has(id))return;
   setItems(old=>payload.eventType==='DELETE'?old.filter(i=>i.id!==id):[...old.filter(i=>i.id!==id),payload.new.data]);
  }).subscribe();
  (async()=>{const {data,error}=await supabase.from('board_objects').select('id,data');if(error){console.error(error);return}if(alive){setItems((data||[]).map(row=>row.data));ready.current=true}})();
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
 const point=e=>{const p=stage.current.getPointerPosition();return{x:(p.x-view.x)/zoom,y:(p.y-view.y)/zoom}};
 const down=e=>{if(e.evt.button===2)return;const p=point(e);if(tool==='hand'){drag.current={x:e.evt.clientX,y:e.evt.clientY,start:view};return}if(tool==='select'){if(!e.target?.attrs?.itemId)setSelected(null);return}if(tool==='eraser'){const id=e.target?.attrs?.itemId;if(id)commit(items.filter(i=>i.id!==id));return}if(tool==='pen'||tool==='line'){const id=crypto.randomUUID();active.current={id,type:tool,points:[p.x,p.y,p.x,p.y],color,size};setItems(prev=>[...prev,{...active.current}])}};
 const move=e=>{if(drag.current){setView({x:drag.current.start.x+e.evt.clientX-drag.current.x,y:Math.min(0,drag.current.start.y+e.evt.clientY-drag.current.y)});return}if(!active.current)return;const p=point(e);const a=active.current;a.points=tool==='line'?[a.points[0],a.points[1],p.x,p.y]:[...a.points,p.x,p.y];setItems(prev=>prev.map(i=>i.id===a.id?{...a}:i))};
 const up=()=>{drag.current=null;const finished=active.current;if(finished){const previous=items.filter(i=>i.id!==finished.id);setHistory(h=>[...h.slice(-39),previous]);setFuture([]);active.current=null;syncDiff(previous,[...previous,{...finished}])}};
 const upload=e=>{const files=[...e.target.files];files.forEach(file=>{if(!file.type.startsWith('image/'))return;const reader=new FileReader();reader.onload=()=>{const img=new window.Image();img.onload=()=>{const ratio=Math.min(1,900/img.width,900/img.height);const c=document.createElement('canvas');c.width=Math.round(img.width*ratio);c.height=Math.round(img.height*ratio);c.getContext('2d').drawImage(img,0,0,c.width,c.height);const p={x:Math.max(0,-view.x/zoom+80),y:Math.max(0,-view.y/zoom+80)};setItems(old=>{setHistory(h=>[...h.slice(-39),old]);setFuture([]);const next=[...old,{id:crypto.randomUUID(),type:'image',src:c.toDataURL('image/jpeg',.82),x:p.x,y:p.y,width:c.width,height:c.height}];syncDiff(old,next);return next})};img.src=reader.result};reader.readAsDataURL(file)});e.target.value=''};
 const wheel=e=>{e.evt.preventDefault();if(e.evt.ctrlKey||e.evt.metaKey){const old=zoom;const next=Math.max(.25,Math.min(3,old*(e.evt.deltaY>0?.92:1.08)));const p=stage.current.getPointerPosition();setView(v=>({x:p.x-(p.x-v.x)*next/old,y:p.y-(p.y-v.y)*next/old}));setZoom(next)}else setView(v=>({x:v.x-e.evt.deltaX,y:Math.min(0,v.y-e.evt.deltaY)}))};
 const fitX=()=>{const z=Math.min(1,(screen.w-32)/WIDTH);setZoom(z);setView({x:(screen.w-WIDTH*z)/2,y:0})};
 return <><header><strong>Моя доска</strong><div className="tools"><button className={tool==='pen'?'active':''} onClick={()=>setTool('pen')}>✏️ Ручка</button><button className={tool==='eraser'?'active':''} onClick={()=>setTool('eraser')}>◻ Ластик</button><button className={tool==='line'?'active':''} onClick={()=>setTool('line')}>╱ Линия</button><button className={tool==='select'?'active':''} onClick={()=>setTool('select')}>↖ Выбор</button><button onClick={()=>{if(selected){commit(items.filter(i=>i.id!==selected));setSelected(null)}}} disabled={!selected}>🗑 Удалить</button><button className={tool==='hand'?'active':''} onClick={()=>setTool('hand')}>✋ Двигать</button><label className="upload">＋ Картинка<input type="file" accept="image/*" multiple onChange={upload} hidden/></label><input aria-label="Цвет" type="color" value={color} onChange={e=>setColor(e.target.value)}/><input aria-label="Толщина" type="range" min="1" max="20" value={size} onChange={e=>setSize(+e.target.value)}/><button onClick={undo} disabled={!history.length}>↶</button><button onClick={redo} disabled={!future.length}>↷</button><button onClick={fitX}>По ширине</button><button onClick={()=>{setZoom(z=>Math.max(.25,z/1.2))}}>−</button><span>{Math.round(zoom*100)}%</span><button onClick={()=>setZoom(z=>Math.min(3,z*1.2))}>＋</button></div></header><div className="workspace"><Stage ref={stage} width={screen.w} height={screen.h} x={view.x} y={view.y} scaleX={zoom} scaleY={zoom} onMouseDown={down} onTouchStart={down} onMouseMove={move} onTouchMove={move} onMouseUp={up} onTouchEnd={up} onWheel={wheel} draggable={false}><Layer><Rect x={0} y={0} width={WIDTH} height={HEIGHT} fill="white" listening={false}/>{items.map(i=>i.type==='image'?<KonvaImage key={i.id} itemId={i.id} ref={node=>imageNodes.current[i.id]=node} image={imageCache.current[i.id]} x={i.x} y={i.y} width={i.width} height={i.height} draggable={tool==='select'} onClick={e=>{if(tool==='select'){e.cancelBubble=true;setSelected(i.id)}}} onTap={e=>{if(tool==='select'){e.cancelBubble=true;setSelected(i.id)}}} onDragStart={e=>{e.cancelBubble=true;setSelected(i.id)}} onDragEnd={e=>{e.cancelBubble=true;commit(items.map(v=>v.id===i.id?{...v,x:e.target.x(),y:e.target.y()}:v))}} onTransformEnd={e=>{e.cancelBubble=true;const n=e.target;const updated={x:n.x(),y:n.y(),width:Math.max(10,n.width()*n.scaleX()),height:Math.max(10,n.height()*n.scaleY())};n.scale({x:1,y:1});commit(items.map(v=>v.id===i.id?{...v,...updated}:v))}}/>:<Line key={i.id} itemId={i.id} points={i.points} stroke={i.color} strokeWidth={i.size} tension={i.type==='pen'?.3:0} lineCap="round" lineJoin="round" hitStrokeWidth={Math.max(20,i.size)} />)}<Transformer ref={transformer} rotateEnabled={false} keepRatio={true} flipEnabled={false} boundBoxFunc={(oldBox,newBox)=>newBox.width<15||newBox.height<15?oldBox:newBox}/></Layer></Stage></div><footer>Прокрутка — колесо мыши · Масштаб — Ctrl + колесо · Для iPad: инструменты и касания · Общая доска синхронизируется через Supabase</footer></>}
createRoot(document.getElementById('root')).render(<Board/>);
