'use strict';

/* ── Countdown ── */
(function() {
  const target = new Date('2026-07-18T18:00:00');
  function pad(n) { return String(n).padStart(2,'0'); }
  function tick() {
    const diff = target - Date.now();
    if (diff <= 0) return;
    document.getElementById('cd-days').textContent  = pad(Math.floor(diff/86400000));
    document.getElementById('cd-hours').textContent = pad(Math.floor((diff%86400000)/3600000));
    document.getElementById('cd-mins').textContent  = pad(Math.floor((diff%3600000)/60000));
    document.getElementById('cd-secs').textContent  = pad(Math.floor((diff%60000)/1000));
  }
  tick(); setInterval(tick,1000);
})();

/* ── Nav scroll ── */
window.addEventListener('scroll',()=>{
  const n=document.getElementById('mainNav');
  if(n) n.style.boxShadow=window.scrollY>40?'0 4px 24px rgba(26,15,10,0.12)':'none';
},{passive:true});

/* ── Scroll Reveal ── */
(function(){
  const io=new IntersectionObserver(entries=>{
    entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in-view');io.unobserve(e.target);}});
  },{threshold:0.12});
  document.querySelectorAll('.reveal').forEach(el=>io.observe(el));
})();

/* ── RSVP + VIDEO ── */
(function(){
  let videoBlob=null, videoId=null, uploadPromise=null;
  let mediaStream=null, mediaRecorder=null, chunks=[];
  let timerInterval=null, secondsLeft=30, isRecording=false;

  const choice   = document.getElementById('rsvpChoice');
  const formYes  = document.getElementById('rsvpFormYes');
  const formNo   = document.getElementById('rsvpFormNo');
  const confirmEl= document.getElementById('rsvpConfirm');

  const yesName  = document.getElementById('yesName');
  const yesSubmit= document.getElementById('yesSubmit');
  const noName   = document.getElementById('noName');
  const noSubmit = document.getElementById('noSubmit');

  const videoLive       = document.getElementById('videoLive');
  const videoPlayback   = document.getElementById('videoPlayback');
  const videoPlaceholder= document.getElementById('videoPlaceholder');
  const videoTimer      = document.getElementById('videoTimer');
  const vidStart        = document.getElementById('vidStart');
  const vidStop         = document.getElementById('vidStop');
  const vidRedo         = document.getElementById('vidRedo');
  const vidBadge        = document.getElementById('vidRecordedBadge');

  function showOnly(el){
    [choice,formYes,formNo,confirmEl].forEach(e=>{
      if(!e) return;
      e.style.display = e===el ? (e===choice?'grid':'block') : 'none';
    });
  }

  document.getElementById('choiceYes').addEventListener('click',()=>showOnly(formYes));
  document.getElementById('choiceNo').addEventListener('click', ()=>showOnly(formNo));
  document.getElementById('backFromYes').addEventListener('click',()=>showOnly(choice));
  document.getElementById('backFromNo').addEventListener('click',()=>{cleanupRec();showOnly(choice);});

  /* YES submit */
  yesSubmit.addEventListener('click',async()=>{
    const name=yesName.value.trim();
    if(!name){shake(yesName);yesName.focus();return;}
    await doSubmit({name,attending:true,videoId:null},yesSubmit);
  });

  /* NO submit — auto-stops recording, waits for upload */
  noSubmit.addEventListener('click',async()=>{
    const name=noName.value.trim();
    if(!name){shake(noName);noName.focus();return;}

    if(isRecording){
      setBtnLabel(noSubmit,'Finishing recording…');
      noSubmit.disabled=true;
      await stopRecAndWait();
    }

    if(videoBlob && !videoId){
      setBtnLabel(noSubmit,'Uploading video…');
      noSubmit.disabled=true;
      try{ videoId = await (uploadPromise||uploadVideo(videoBlob)); }
      catch(e){ videoId=null; }
    }

    await doSubmit({name,attending:false,videoId},noSubmit);
  });

  async function doSubmit(data,btn){
    setBtnLabel(btn,'Sending…'); btn.disabled=true;
    try{
      const r=await fetch('/api/rsvp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
      if(!r.ok) throw new Error();
      showConfirm(data.name,data.attending);
    }catch{
      alert('Something went wrong. Please try again.');
      btn.disabled=false;
      setBtnLabel(btn, data.attending?'Confirm Attendance':'Send My Regrets');
    }
  }

  function showConfirm(name,attending){
    cleanupRec();
    confirmEl.innerHTML=`
      <span class="confirm-icon">${attending?'✦':'◇'}</span>
      <div class="confirm-heading">${attending?"We'll see you there!":"Until next time"}</div>
      <div class="confirm-body">${attending
        ?`Thank you, <strong>${esc(name)}</strong>. We are so delighted you will be joining us!`
        :`Thank you, <strong>${esc(name)}</strong>. Your love and well-wishes mean the world to us.`
      }</div>`;
    showOnly(confirmEl);
    confirmEl.scrollIntoView({behavior:'smooth',block:'center'});
  }

  async function uploadVideo(blob){
    const fd=new FormData();
    fd.append('video',blob,'message.webm');
    const r=await fetch('/api/video-preupload',{method:'POST',body:fd});
    if(!r.ok) throw new Error('upload failed');
    return (await r.json()).videoId;
  }

  /* Recording controls */
  vidStart.addEventListener('click',startRec);
  vidStop.addEventListener('click',()=>stopRecAndWait());
  vidRedo.addEventListener('click',redoRec);

  async function startRec(){
    try{ mediaStream=await navigator.mediaDevices.getUserMedia({video:true,audio:true}); }
    catch{ alert('Allow camera & microphone access, then try again.'); return; }

    chunks=[]; videoBlob=null; videoId=null; uploadPromise=null; isRecording=true;

    videoLive.srcObject=mediaStream;
    videoLive.style.display='block';
    videoPlayback.style.display='none';
    videoPlaceholder.style.display='none';
    videoTimer.style.display='block';
    vidStart.style.display='none'; vidStop.style.display='inline-flex';
    vidRedo.style.display='none';  vidBadge.style.display='none';

    const mime=getSupportedMime();
    mediaRecorder=new MediaRecorder(mediaStream, mime?{mimeType:mime}:{});
    mediaRecorder.ondataavailable=e=>{ if(e.data?.size>0) chunks.push(e.data); };

    secondsLeft=30; updateTimer();
    timerInterval=setInterval(()=>{ secondsLeft--; updateTimer(); if(secondsLeft<=0) stopRecAndWait(); },1000);
    mediaRecorder.start(250);
  }

  function stopRecAndWait(){
    return new Promise(resolve=>{
      clearInterval(timerInterval);
      isRecording=false;
      if(!mediaRecorder||mediaRecorder.state==='inactive'){ resolve(); return; }
      mediaRecorder.onstop=()=>{ finaliseRec(); resolve(); };
      mediaRecorder.stop();
      stopStream();
    });
  }

  function finaliseRec(){
    videoBlob=new Blob(chunks,{type:chunks[0]?.type||'video/webm'});
    const url=URL.createObjectURL(videoBlob);
    videoPlayback.src=url;
    videoPlayback.style.display='block';
    videoLive.style.display='none';
    videoTimer.style.display='none';
    videoPlaceholder.style.display='none';
    vidStop.style.display='none'; vidRedo.style.display='inline-flex';
    vidBadge.style.display='inline-flex'; vidStart.style.display='none';
    /* Background upload immediately */
    uploadPromise=uploadVideo(videoBlob).then(id=>{videoId=id;}).catch(()=>{videoId=null;});
  }

  function redoRec(){
    cleanupRec();
    videoPlayback.style.display='none';
    videoPlaceholder.style.display='flex';
    vidBadge.style.display='none'; vidRedo.style.display='none';
    vidStart.style.display='inline-flex'; vidStop.style.display='none';
    videoBlob=null; videoId=null;
  }

  function stopStream(){ mediaStream?.getTracks().forEach(t=>t.stop()); mediaStream=null; }

  function cleanupRec(){
    clearInterval(timerInterval); isRecording=false;
    if(mediaRecorder&&mediaRecorder.state!=='inactive'){ mediaRecorder.onstop=null; mediaRecorder.stop(); }
    stopStream();
    videoLive.style.display='none'; videoTimer.style.display='none';
  }

  function updateTimer(){
    videoTimer.textContent=`${Math.floor(secondsLeft/60)}:${String(secondsLeft%60).padStart(2,'0')}`;
    videoTimer.style.background=secondsLeft<=10?'rgba(192,57,43,0.9)':'rgba(139,69,19,0.85)';
  }

  function getSupportedMime(){
    return ['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm','video/mp4']
      .find(t=>MediaRecorder.isTypeSupported(t))||'';
  }

  function setBtnLabel(btn,label){ const s=btn.querySelector('span'); if(s) s.textContent=label; }
  function shake(el){ el.style.animation='none'; el.offsetHeight; el.style.animation='shake 0.35s ease'; el.addEventListener('animationend',()=>{el.style.animation='';},{once:true}); }
  function esc(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  const st=document.createElement('style');
  st.textContent='@keyframes shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-6px)}40%,80%{transform:translateX(6px)}}';
  document.head.appendChild(st);
})();
