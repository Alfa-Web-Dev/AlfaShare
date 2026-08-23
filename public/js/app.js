(() => {
  "use strict";

  /* AlfaShare 3.0
     Direct WebRTC DataChannel. The signaling server only exchanges SDP/ICE.
     File bytes never intentionally travel through Socket.IO.
  */
  const CHUNK = 128 * 1024;
  const HIGH_WATER = 24 * 1024 * 1024;
  const LOW_WATER = 6 * 1024 * 1024;
  const ACK_WINDOW = 128; // ~16 MB acknowledged at a time
  const ICE = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" }
  ];
  const $ = id => document.getElementById(id);
  const el = {
    statusDot:$('statusDot'), statusText:$('statusText'), serverText:$('serverText'), mobileStatus:$('mobileStatus'),
    sidePeerId:$('sidePeerId'), settingsPeerId:$('settingsPeerId'), copySideId:$('copySideId'), copySettingsId:$('copySettingsId'),
    serverUrl:$('serverUrl'), remote:$('remotePeerId'), connect:$('connectBtn'), paste:$('pastePeerBtn'), connectMessage:$('connectMessage'),
    chatConnection:$('chatConnection'), chatPeerName:$('chatPeerName'), chatPeerSub:$('chatPeerSub'), chatDisconnect:$('chatDisconnect'),
    peerAvatar:$('peerAvatar'), infoAvatar:$('infoAvatar'), infoPeer:$('infoPeer'), infoPeerAddress:$('infoPeerAddress'),
    messages:$('messages'), chatForm:$('chatForm'), chatInput:$('chatInput'), send:$('sendBtn'), emojiBtn:$('emojiBtn'), emojiPanel:$('emojiPanel'),
    attachBtn:$('attachBtn'), cameraBtn:$('cameraBtn'), chatFileInput:$('chatFileInput'), cameraInput:$('cameraInput'), gifPanel:$('gifPanel'), gifUrl:$('gifUrl'), sendGif:$('sendGif'), gifResults:$('gifResults'),
    dropzone:$('dropzone'), fileInput:$('fileInput'), chooseFiles:$('chooseFiles'), transfers:$('transfers'), history:$('history'), clearHistory:$('clearHistory'), speedStat:$('speedStat'),
    toast:$('toast'), themes:$('themes'), nav:document.querySelectorAll('.nav-item'), tabs:document.querySelectorAll('.tab'),
    openSettings:$('openSettings'), openSettings2:$('openSettings2'), menuBtn:$('menuBtn'), closeMenuBtn:$('closeMenuBtn'), sidebar:$('sidebar'),
    installBtn:$('installBtn'), installStatus:$('installStatus'), profileName:$('profileName'), saveProfile:$('saveProfile'), profileStatus:$('profileStatus'), contacts:$('contacts'), clearContacts:$('clearContacts')
  };

  const storage = { history:'alfashare-history', peer:'alfashare-peer-id', theme:'alfashare-theme', name:'alfashare-profile-name', contacts:'alfashare-contacts', chats:'alfashare-chats' };
  let peerId = getPeerId();
  let profileName = (localStorage.getItem(storage.name)||'').trim().slice(0,40) || 'AlfaShare user';
  let socket = null, pc = null, channel = null, remotePeer = null, remotePeerName = '', pendingCandidates = [];
  const outgoing = new Map();
  const incoming = new Map();
  let receiveQueue = Promise.resolve();
  let deferredInstallPrompt = null;

  function makePeerId(){
    const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes=crypto.getRandomValues(new Uint8Array(8));
    return [...bytes].map(n=>alphabet[n%alphabet.length]).join('');
  }
  function getPeerId(){
    // Stable identity for this browser/origin. It changes only if site storage is cleared.

    const saved=(localStorage.getItem(storage.peer)||'').toUpperCase();
    if(/^[A-Z0-9]{8}$/.test(saved)) return saved;
    const id=makePeerId(); localStorage.setItem(storage.peer,id); return id;
  }
  function setIdentity(){ el.sidePeerId.textContent=peerId; el.settingsPeerId.textContent=peerId; el.serverUrl.textContent=location.origin; if(el.profileName)el.profileName.value=profileName; }
  setIdentity();

  function toast(message){ el.toast.textContent=message; el.toast.classList.add('show'); clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.toast.classList.remove('show'),2600); }
  function setServerStatus(text,on=false){
    el.statusText.textContent=text; el.statusDot.classList.toggle('on',on); el.mobileStatus.classList.toggle('on',on);
  }
  function setPeerUI(connected){
    el.chatInput.disabled=!connected; el.send.disabled=!connected;
    el.chatConnection.textContent=connected?`Connected • ${remotePeer}`:'Not connected';
    el.chatPeerName.textContent=connected?(remotePeerName||remotePeer):'No peer connected';
    el.chatPeerSub.textContent=connected?'Direct encrypted connection':'Connect from Settings'; if(connected&&remotePeer)loadChatHistory(remotePeer);
    const letter=connected?(remotePeerName||remotePeer)[0].toUpperCase():'?'; el.peerAvatar.textContent=letter; el.infoAvatar.textContent=letter;
    el.infoPeer.textContent=connected?(remotePeerName||remotePeer):'Not connected'; el.infoPeerAddress.textContent=connected?remotePeer:'—';
  }
  function showTab(name){
    el.nav.forEach(b=>b.classList.toggle('active',b.dataset.tab===name));
    el.tabs.forEach(t=>t.classList.toggle('active',t.id===`tab-${name}`));
    el.sidebar.classList.remove('open');
  }
  el.nav.forEach(b=>b.addEventListener('click',()=>showTab(b.dataset.tab)));
  el.openSettings?.addEventListener('click',()=>showTab('settings'));
  el.openSettings2?.addEventListener('click',()=>showTab('settings'));
  el.menuBtn.addEventListener('click',()=>el.sidebar.classList.toggle('open'));
  el.closeMenuBtn.addEventListener('click',()=>el.sidebar.classList.remove('open'));
  document.addEventListener('keydown',e=>{if(e.key==='Escape')el.sidebar.classList.remove('open')});
  document.addEventListener('click',e=>{if(innerWidth<=900&&el.sidebar.classList.contains('open')&&!el.sidebar.contains(e.target)&&e.target!==el.menuBtn)el.sidebar.classList.remove('open')});

  async function copyPeer(){try{await navigator.clipboard.writeText(peerId);toast('Peer code copied')}catch{toast(peerId)}}
  el.copySideId.onclick=copyPeer; el.copySettingsId.onclick=copyPeer;

  function signal(to,data){ if(socket?.connected) socket.emit('signal',{to,data}); }
  function createPC(id,initiator){
    try{pc?.close()}catch{}
    pendingCandidates=[];
    pc=new RTCPeerConnection({iceServers:ICE});
    pc.onicecandidate=e=>{if(e.candidate)signal(id,{type:'candidate',candidate:e.candidate})};
    pc.onconnectionstatechange=()=>{
      if(pc?.connectionState==='connected'){setServerStatus('P2P Connected',true);setPeerUI(true);toast('Direct connection ready')}
      if(['failed','disconnected','closed'].includes(pc?.connectionState)){setPeerUI(false);setServerStatus(socket?.connected?'Server Connected':'Disconnected',!!socket?.connected)}
    };
    pc.ondatachannel=e=>bindChannel(e.channel);
    if(initiator)bindChannel(pc.createDataChannel('alfashare',{ordered:true}));
  }
  function bindChannel(dc){
    channel=dc; channel.binaryType='arraybuffer'; channel.bufferedAmountLowThreshold=LOW_WATER;
    channel.onopen=()=>{setServerStatus('P2P Connected',true);setPeerUI(true);toast('Direct connection ready')};
    channel.onclose=()=>{setPeerUI(false);setServerStatus(socket?.connected?'Server Connected':'Disconnected',!!socket?.connected)};
    channel.onerror=()=>toast('P2P data channel error');
    channel.onmessage=e=>{receiveQueue=receiveQueue.then(()=>handleChannelData(e.data)).catch(err=>{console.error(err);toast('Transfer error — connection kept safe')})};
  }
  function normalizeCode(v){return String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8)}
  el.remote.oninput=e=>e.target.value=normalizeCode(e.target.value);
  el.remote.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();connectPeer()}};
  el.paste.onclick=async()=>{try{el.remote.value=normalizeCode(await navigator.clipboard.readText());el.remote.focus();}catch{el.remote.focus();toast('Paste permission unavailable — type the code')}};
  function loadContacts(){ try{return JSON.parse(localStorage.getItem(storage.contacts)||'[]')}catch{return []} }
  function saveContact(id,name){ if(!id)return; const list=loadContacts().filter(x=>x.id!==id); list.unshift({id,name:name||id,lastSeen:Date.now()}); localStorage.setItem(storage.contacts,JSON.stringify(list.slice(0,30))); renderContacts(); }
  function renderContacts(){ if(!el.contacts)return; const list=loadContacts(); el.contacts.innerHTML=''; if(!list.length){el.contacts.innerHTML='<div class="empty-history">No connected peers yet.</div>';return;} list.forEach(x=>{const row=document.createElement('button');row.type='button';row.className='history-row contact-row';row.innerHTML=`<span class="history-icon">●</span><div><strong>${escapeHtml(x.name||x.id)}</strong><small>${escapeHtml(x.id)} • Last connected ${new Date(x.lastSeen).toLocaleDateString()}</small></div>`;row.onclick=()=>{showTab('settings');el.remote.value=x.id;connectPeer(x.id)};el.contacts.appendChild(row)}) }
  renderContacts();
  el.clearContacts?.addEventListener('click',()=>{localStorage.removeItem(storage.contacts);renderContacts();toast('Contacts cleared')});
  el.saveProfile?.addEventListener('click',()=>{profileName=(el.profileName.value.trim().slice(0,40)||'AlfaShare user');localStorage.setItem(storage.name,profileName);el.profileStatus.textContent='Saved ✓';toast('Profile name saved'); if(socket?.connected)socket.emit('register',peerId,{name:profileName},()=>{});});

  async function connectPeer(preferredId){
    const target=normalizeCode(preferredId || el.remote.value); el.remote.value=target;
    if(!socket?.connected){el.connectMessage.textContent='Signaling server is offline.';toast('AlfaShare server is offline');return false;}
    if(!/^[A-Z0-9]{8}$/.test(target)){el.connectMessage.textContent='Enter the 8-character peer code.';return false;}
    if(target===peerId){el.connectMessage.textContent='That is your own peer code.';return false;}
    const status=await new Promise(resolve=>{
      let done=false;
      const finish=result=>{if(done)return;done=true;clearTimeout(timer);resolve(result||{online:false});};
      const timer=setTimeout(()=>finish({online:false,timeout:true}),7000);
      try{socket.emit('check-peer',target,finish)}catch(error){finish({online:false,error:String(error?.message||error)})}
    });
    if(!status.online){
      const message=status.timeout?'Peer lookup timed out. Please try again.':(status.error?'Could not check peer status. Please try again.':'This peer is offline.');
      el.connectMessage.textContent=message;
      toast(message);
      return false;
    }
    remotePeer=target; remotePeerName=status.name||target; saveContact(target,remotePeerName); setPeerUI(false); el.connectMessage.textContent=`Connecting to ${remotePeerName}…`;
    createPC(target,true);
    try{const offer=await pc.createOffer();await pc.setLocalDescription(offer);signal(target,{type:'offer',sdp:pc.localDescription})}
    catch(e){console.error(e);el.connectMessage.textContent='Could not start connection.';toast('Connection could not be started')}
    return true;
  }
  el.connect.onclick=async()=>{ try{ await connectPeer(); }catch(error){ console.error(error); el.connectMessage.textContent='Connection error. Please try again.'; toast('Connection error — please try again'); } };

  async function onSignal({from,name,data}){
    remotePeer=from; remotePeerName=name||from; saveContact(from,remotePeerName);
    try{
      if(data.type==='offer'){
        createPC(from,false); await pc.setRemoteDescription(data.sdp);
        const answer=await pc.createAnswer(); await pc.setLocalDescription(answer); signal(from,{type:'answer',sdp:pc.localDescription});
      }else if(data.type==='answer'&&pc){await pc.setRemoteDescription(data.sdp)}
      else if(data.type==='candidate'){
        if(pc?.remoteDescription)await pc.addIceCandidate(data.candidate); else pendingCandidates.push(data.candidate);
      }
      if(pc?.remoteDescription&&pendingCandidates.length){for(const c of pendingCandidates)await pc.addIceCandidate(c);pendingCandidates=[]}
    }catch(e){console.error(e);el.connectMessage.textContent='Direct connection negotiation failed.'}
  }
  function disconnect(){
    for(const x of outgoing.values())x.cancelled=true;
    try{channel?.close()}catch{} try{pc?.close()}catch{}
    channel=null;pc=null;remotePeer=null;remotePeerName='';outgoing.clear();incoming.clear();setPeerUI(false);setServerStatus(socket?.connected?'Server Connected':'Disconnected',!!socket?.connected);el.connectMessage.textContent='Disconnected.';
  }
  el.chatDisconnect.onclick=disconnect;

  function sendControl(payload){if(!channel||channel.readyState!=='open')throw Error('Not connected');channel.send(JSON.stringify(payload))}
  function addMessage(text,mine=false,kind='text'){
    document.querySelector('.empty-chat')?.remove();
    const row=document.createElement('div');row.className=`message ${mine?'mine':''}`;
    const bubble=document.createElement('div');bubble.className='bubble';
    if(kind==='gif'){const img=document.createElement('img');img.src=text;img.alt='GIF';img.loading='lazy';bubble.appendChild(img)}else bubble.appendChild(document.createTextNode(text));
    const meta=document.createElement('small');meta.className='message-meta';meta.textContent=mine?'You':'Peer';bubble.appendChild(meta);row.appendChild(bubble);el.messages.appendChild(row);el.messages.scrollTop=el.messages.scrollHeight;
  }
  function saveChatMessage(peerId,key){ if(!peerId)return; const all=JSON.parse(localStorage.getItem(storage.chats)||'{}'); all[peerId]=all[peerId]||[]; all[peerId].push(key); all[peerId]=all[peerId].slice(-100); localStorage.setItem(storage.chats,JSON.stringify(all)); }
  function loadChatHistory(id){ if(!el.messages)return; const all=JSON.parse(localStorage.getItem(storage.chats)||'{}'); const list=all[id]||[]; if(!list.length)return; document.querySelector('.empty-chat')?.remove(); list.forEach(m=>addMessage(m.text,m.mine,m.kind,false)); }
  el.chatForm.onsubmit=e=>{e.preventDefault();const text=el.chatInput.value.trim();if(!text)return;try{sendControl({kind:'chat',text,at:Date.now()});addMessage(text,true,'text');saveChatMessage(remotePeer,{text,mine:true,kind:'text'});el.chatInput.value=''}catch{toast('Connect to a peer first')}};
  el.attachBtn?.addEventListener('click',()=>el.chatFileInput.click());
  el.cameraBtn?.addEventListener('click',()=>el.cameraInput.click());
  el.chatFileInput?.addEventListener('change',()=>{[...el.chatFileInput.files].forEach(sendFile);el.chatFileInput.value=''});
  el.cameraInput?.addEventListener('change',()=>{[...el.cameraInput.files].forEach(sendFile);el.cameraInput.value=''});
  el.chatInput?.addEventListener('paste',e=>{const items=[...(e.clipboardData?.items||[])];const image=items.find(i=>i.kind==='file'&&i.type.startsWith('image/'));if(image){const file=image.getAsFile();if(file){e.preventDefault();sendFile(new File([file],`pasted-image-${Date.now()}.${(file.type.split('/')[1]||'png')}`,{type:file.type}))}}});
  el.chatInput?.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();el.chatForm.requestSubmit()}});

  function formatBytes(n){if(!Number.isFinite(n))return '—';const u=['B','KB','MB','GB','TB'];let i=0,v=n;while(v>=1024&&i<u.length-1){v/=1024;i++}return `${v<10&&i?v.toFixed(1):Math.round(v)} ${u[i]}`}
  function formatSpeed(bps){return `${formatBytes(bps)}/s`}
  function formatEta(seconds){if(!Number.isFinite(seconds)||seconds<0||seconds>86400)return '—';if(seconds<60)return `${Math.ceil(seconds)}s`;const m=Math.floor(seconds/60),s=Math.ceil(seconds%60);return `${m}m ${s}s`}
  function transferUI(name,direction,size){
    const box=document.createElement('div');box.className='transfer';
    box.innerHTML=`<div class="transfer-top"><div class="file-symbol">${direction==='out'?'↑':'↓'}</div><div class="file-info"><strong title="${escapeHtml(name)}">${escapeHtml(name)}</strong><span>${formatBytes(size)} • ${direction==='out'?'Sending':'Receiving'}</span></div><strong class="transfer-percent">0%</strong></div><div class="progress"><i></i></div><div class="transfer-bottom"><span class="transfer-status">Preparing…</span><span class="transfer-speed">—</span></div>`;
    el.transfers.prepend(box);return {box,bar:box.querySelector('.progress i'),pct:box.querySelector('.transfer-percent'),status:box.querySelector('.transfer-status'),speed:box.querySelector('.transfer-speed')};
  }
  function escapeHtml(v){return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}

  async function waitBuffered(){
    if(!channel||channel.readyState!=='open')throw Error('Connection closed');
    if(channel.bufferedAmount<=HIGH_WATER)return;
    await new Promise(resolve=>{const done=()=>{channel.removeEventListener('bufferedamountlow',done);resolve()};channel.addEventListener('bufferedamountlow',done,{once:true})});
  }
  function waitAck(state,index){if(state.acked>=index)return Promise.resolve();return new Promise(resolve=>{state.waiting={index,resolve}})}
  function handleAck(m){const s=outgoing.get(m.id);if(!s)return;s.acked=Math.max(s.acked,Number(m.index));if(s.waiting&&s.acked>=s.waiting.index){const r=s.waiting.resolve;s.waiting=null;r()}}

  async function sendFile(file){
    if(!channel||channel.readyState!=='open')return toast('Connect a peer first.');
    if(file.size===0)return toast('Empty files are not supported.');
    const id=crypto.randomUUID(), total=Math.ceil(file.size/CHUNK), ui=transferUI(file.name,'out',file.size);
    const state={file,acked:-1,waiting:null,cancelled:false,start:performance.now(),lastBytes:0,lastTime:performance.now()};outgoing.set(id,state);
    try{
      sendControl({kind:'file-start',id,name:file.name,size:file.size,type:file.type||'application/octet-stream',total,chunkSize:CHUNK,protocol:3});
      for(let index=0,offset=0;index<total;index++,offset+=CHUNK){
        if(state.cancelled)throw Error('Cancelled');
        await waitBuffered();
        const bytes=await file.slice(offset,Math.min(offset+CHUNK,file.size)).arrayBuffer();
        sendControl({kind:'file-chunk',id,index});channel.send(bytes);
        if(index%ACK_WINDOW===ACK_WINDOW-1||index===total-1)await waitAck(state,index);
        const done=Math.min(offset+CHUNK,file.size),pct=Math.round(done/file.size*100);ui.bar.style.width=pct+'%';ui.pct.textContent=pct+'%';
        const now=performance.now(),dt=(now-state.lastTime)/1000;if(dt>=.35){const bps=(done-state.lastBytes)/dt;ui.speed.textContent=formatSpeed(bps);ui.status.textContent=`Sending • ${formatEta((file.size-done)/Math.max(bps,1))} left`;el.speedStat.textContent=formatSpeed(bps);state.lastBytes=done;state.lastTime=now}
      }
      sendControl({kind:'file-end',id});ui.pct.textContent='100%';ui.status.textContent='Sent ✓';ui.speed.textContent='Complete';addHistory(file.name,file.size,'sent');toast(`${file.name} sent`);
    }catch(e){ui.status.textContent=state.cancelled?'Cancelled':'Transfer stopped';ui.pct.textContent='—';toast(state.cancelled?'Transfer cancelled':'Large-file transfer stopped')}
    finally{outgoing.delete(id)}
  }

  const OPFS=!!navigator.storage?.getDirectory;
  async function makeWriter(meta){
    if(!OPFS)return null;
    const root=await navigator.storage.getDirectory();
    const safe=safeName(meta.name);const path=`alfashare-${crypto.randomUUID().slice(0,8)}-${safe}`;
    const handle=await root.getFileHandle(path,{create:true});const writable=await handle.createWritable();
    return {handle,writable,path};
  }
  function safeName(name){return (String(name||'file').replace(/[\\/:*?"<>|\x00-\x1F]/g,'_').trim()||'file').slice(0,160)}

  async function handleChannelData(data){
    if(typeof data==='string'){
      let m;try{m=JSON.parse(data)}catch{return}
      if(m.kind==='chat'){addMessage(m.text,false,'text');saveChatMessage(remotePeer,{text:m.text,mine:false,kind:'text'});}
      else if(m.kind==='gif')addMessage(m.url,false,'gif');
      else if(m.kind==='file-start'){
        // Keep one active incoming file per peer. This makes framing deterministic and memory-safe.
        if(incoming.size)sendControl({kind:'file-reject',id:m.id,reason:'Another file is currently receiving'});
        else{
          const ui=transferUI(m.name,'in',m.size);let writer=null;try{writer=await makeWriter(m)}catch(e){console.warn(e)}
          incoming.set(m.id,{meta:m,ui,writer,parts:writer?null:[],received:0,expected:null,bytes:0,start:performance.now(),lastBytes:0,lastTime:performance.now()});
          ui.status.textContent=writer?'Receiving to local storage…':'Receiving…';
        }
      }else if(m.kind==='file-chunk'){
        const item=incoming.get(m.id);if(item)item.expected=m.index;
      }else if(m.kind==='file-end')await finishIncoming(m.id);
      else if(m.kind==='file-ack')handleAck(m);
      else if(m.kind==='file-reject')toast(m.reason||'Peer rejected the file');
      return;
    }
    const item=[...incoming.values()][0];if(!item||item.expected===null)return;
    const index=item.expected;item.expected=null;
    const bytes=data instanceof ArrayBuffer?new Uint8Array(data):new Uint8Array(await data.arrayBuffer());
    if(item.writer)await item.writer.writable.write(bytes);else item.parts.push(bytes);
    item.received++;item.bytes+=bytes.byteLength;
    const pct=Math.round(item.received/item.meta.total*100);item.ui.bar.style.width=pct+'%';item.ui.pct.textContent=pct+'%';
    const now=performance.now(),dt=(now-item.lastTime)/1000;if(dt>=.35){const bps=(item.bytes-item.lastBytes)/dt;item.ui.speed.textContent=formatSpeed(bps);item.ui.status.textContent=`Receiving • ${formatEta((item.meta.size-item.bytes)/Math.max(bps,1))} left`;el.speedStat.textContent=formatSpeed(bps);item.lastBytes=item.bytes;item.lastTime=now}
    if(item.received%ACK_WINDOW===0||item.received===item.meta.total)sendControl({kind:'file-ack',id:item.meta.id,index});
  }
  async function finishIncoming(id){
    const item=incoming.get(id);if(!item)return;
    if(item.received!==item.meta.total){item.ui.status.textContent=`Incomplete ${item.received}/${item.meta.total}`;try{await item.writer?.writable.abort()}catch{};incoming.delete(id);return}
    if(item.writer){
      try{await item.writer.writable.close();item.ui.pct.textContent='100%';item.ui.status.textContent='Received ✓';item.ui.speed.textContent='Complete';addHistory(item.meta.name,item.meta.size,'received');addSaveButton(item);toast(`${item.meta.name} received`)}catch(e){console.error(e);item.ui.status.textContent='Could not save file'}
    }else{
      // Fallback only for browsers without OPFS. It is intentionally capped to protect mobile RAM.
      const total=item.meta.size;if(total>64*1024*1024){item.ui.status.textContent='Browser storage unavailable for this large file';toast('Use a browser with local storage support for large files');incoming.delete(id);return}
      const blob=new Blob(item.parts,{type:item.meta.type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=item.meta.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);item.ui.pct.textContent='100%';item.ui.status.textContent='Received ✓';addHistory(item.meta.name,item.meta.size,'received');toast(`${item.meta.name} received`)
    }
    incoming.delete(id);
  }
  async function addSaveButton(item){
    const b=document.createElement('button');b.className='save-button';b.textContent='Save to device';b.type='button';
    b.onclick=async()=>{
      try{
        const file=await item.writer.handle.getFile();
        if(window.showSaveFilePicker){const h=await window.showSaveFilePicker({suggestedName:item.meta.name});const out=await h.createWritable();const reader=file.stream().getReader();while(true){const r=await reader.read();if(r.done)break;await out.write(r.value)}await out.close();toast('Saved to device ✓')}
        else{const url=URL.createObjectURL(file);const a=document.createElement('a');a.href=url;a.download=item.meta.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);toast('Download started')}
      }catch(e){if(e?.name!=='AbortError')toast('Save cancelled')}
    };item.ui.box.appendChild(b);
  }

  function addHistory(name,size,direction){
    const list=JSON.parse(localStorage.getItem(storage.history)||'[]');list.unshift({name,size,direction,time:Date.now()});localStorage.setItem(storage.history,JSON.stringify(list.slice(0,40)));renderHistory();
  }
  function renderHistory(){
    const list=JSON.parse(localStorage.getItem(storage.history)||'[]');el.history.innerHTML='';
    if(!list.length){el.history.innerHTML='<div class="empty-history">No transfers yet.</div>';return}
    list.forEach(x=>{const row=document.createElement('div');row.className='history-row';row.innerHTML=`<span class="history-icon">${x.direction==='sent'?'↑':'↓'}</span><div><strong title="${escapeHtml(x.name)}">${escapeHtml(x.name)}</strong><small>${x.direction==='sent'?'Sent':'Received'} • ${formatBytes(x.size)} • ${new Date(x.time).toLocaleString()}</small></div>`;el.history.appendChild(row)});
  }
  el.clearHistory.onclick=()=>{localStorage.removeItem(storage.history);renderHistory();toast('History cleared')};renderHistory();
  el.chooseFiles.onclick=()=>el.fileInput.click();el.dropzone.addEventListener('click',e=>{if(!e.target.closest('button'))el.fileInput.click()});
  el.fileInput.onchange=()=>{[...el.fileInput.files].forEach(sendFile);el.fileInput.value=''};
  ['dragenter','dragover'].forEach(e=>el.dropzone.addEventListener(e,x=>{x.preventDefault();el.dropzone.classList.add('drag')}));
  ['dragleave','drop'].forEach(e=>el.dropzone.addEventListener(e,x=>{x.preventDefault();el.dropzone.classList.remove('drag')}));
  el.dropzone.addEventListener('drop',e=>[...e.dataTransfer.files].forEach(sendFile));

  el.themes.querySelectorAll('button').forEach(b=>b.onclick=()=>{const t=b.dataset.theme;document.documentElement.dataset.theme=t;localStorage.setItem(storage.theme,t);el.themes.querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b))});
  const theme=localStorage.getItem(storage.theme)||'dark';document.documentElement.dataset.theme=theme;el.themes.querySelectorAll('button').forEach(b=>b.classList.toggle('active',b.dataset.theme===theme));

  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstallPrompt=e;el.installStatus.textContent='Ready to install'});
  window.addEventListener('appinstalled',()=>{deferredInstallPrompt=null;el.installStatus.textContent='Installed ✓';toast('AlfaShare installed')});
  el.installBtn.onclick=async()=>{if(deferredInstallPrompt){deferredInstallPrompt.prompt();const r=await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;el.installStatus.textContent=r.outcome==='accepted'?'Installed ✓':'Install cancelled'}else toast('Use browser menu → Install app')};

  function startSocket(){
    setServerStatus('Connecting…');
    socket=io({transports:['websocket','polling'],reconnection:true,reconnectionAttempts:Infinity,reconnectionDelay:1000,reconnectionDelayMax:5000,timeout:10000});
    socket.on('connect',()=>{
      el.serverText.textContent='Signaling connected';setServerStatus('Server Connected',true);
      socket.emit('register',peerId,{name:profileName},result=>{
        if(!result?.ok){
          el.connectMessage.textContent=result?.error||'Could not register this peer.';
          toast(result?.error||'Could not register this peer.');
          return;
        }
        peerId=result.peerId||peerId;
        localStorage.setItem(storage.peer,peerId);
        setIdentity();
        el.connectMessage.textContent='Ready — enter a peer code.';
      });
    });
    socket.on('signal',onSignal);
    socket.on('peer-offline',({peerId:id})=>{el.connectMessage.textContent='This peer is offline.';toast(`${id||'Peer'} is offline`)});
    socket.on('disconnect',()=>{el.serverText.textContent='Signaling offline';if(!pc||pc.connectionState!=='connected')setServerStatus('Disconnected')});
    socket.on('connect_error',()=>{el.serverText.textContent='Cannot reach signaling server';if(!pc||pc.connectionState!=='connected')setServerStatus('Disconnected')});
  }
  if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'}).then(r=>r.update()).catch(()=>{});
  startSocket();
})();
