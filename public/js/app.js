(() => {
"use strict";

const CHUNK = 64 * 1024; // 4x larger than the previous build.
const HIGH_WATER = 4 * 1024 * 1024;
const LOW_WATER = 512 * 1024;
const ICE = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" }
];

const $ = id => document.getElementById(id);
const els = {
  statusDot:$("statusDot"), statusText:$("statusText"), serverText:$("serverText"), mobileStatus:$("mobileStatus"),
  sidePeerId:$("sidePeerId"), settingsPeerId:$("settingsPeerId"), copySideId:$("copySideId"), copySettingsId:$("copySettingsId"),
  serverUrl:$("serverUrl"), remote:$("remotePeerId"), connect:$("connectBtn"), connectMessage:$("connectMessage"),
  chatConnection:$("chatConnection"), chatPeerName:$("chatPeerName"), chatPeerSub:$("chatPeerSub"), chatDisconnect:$("chatDisconnect"), pastePeerBtn:$("pastePeerBtn"), quickConnectBtn:$("quickConnectBtn"), installBtn:$("installBtn"), installStatus:$("installStatus"),
  peerAvatar:$("peerAvatar"), infoAvatar:$("infoAvatar"), infoPeer:$("infoPeer"), infoPeerAddress:$("infoPeerAddress"),
  messages:$("messages"), chatForm:$("chatForm"), chatInput:$("chatInput"), send:$("sendBtn"),
  emojiBtn:$("emojiBtn"), emojiPanel:$("emojiPanel"), gifBtn:$("gifBtn"), gifPanel:$("gifPanel"), gifUrl:$("gifUrl"), sendGif:$("sendGif"), gifResults:$("gifResults"),
  dropzone:$("dropzone"), fileInput:$("fileInput"), chooseFiles:$("chooseFiles"), transfers:$("transfers"), history:$("history"), clearHistory:$("clearHistory"),
  speedStat:$("speedStat"), toast:$("toast"), themes:$("themes"), nav:document.querySelectorAll(".nav-item"), tabs:document.querySelectorAll(".tab"),
  openSettings:$("openSettings"), menuBtn:$("menuBtn"), closeMenuBtn:$("closeMenuBtn"), sidebar:document.querySelector(".sidebar")
};

let peerId = loadPeerId();
let socket, pc, channel, remotePeer = null, pendingCandidates = [];
let incoming = new Map(), outgoing = new Map(), lastSpeed = 0;

function loadPeerId() {
  const saved = localStorage.getItem("alfashare-peer-id");
  if (saved && /^[A-Z0-9]{8,32}$/.test(saved)) return saved;
  const id = [...crypto.getRandomValues(new Uint8Array(10))].map(x => x.toString(16).padStart(2,"0")).join("").toUpperCase();
  localStorage.setItem("alfashare-peer-id", id);
  return id;
}

function setIds() {
  els.sidePeerId.textContent = peerId;
  els.settingsPeerId.textContent = peerId;
  els.serverUrl.textContent = location.origin;
}
setIds();

function toast(text) {
  els.toast.textContent = text; els.toast.classList.add("show");
  clearTimeout(toast.t); toast.t = setTimeout(() => els.toast.classList.remove("show"), 2400);
}
function setStatus(text, on=false) {
  els.statusText.textContent=text; els.statusDot.classList.toggle("on",on); els.mobileStatus.classList.toggle("on",on);
}
function setConnection(on) {
  els.chatInput.disabled=!on; els.send.disabled=!on;
  els.chatConnection.textContent=on ? `Connected • ${remotePeer}` : "Not connected";
  els.chatPeerName.textContent=on ? remotePeer : "No peer connected";
  els.chatPeerSub.textContent=on ? "Direct encrypted connection" : "Connect from Settings";
  const letter=on ? remotePeer[0] : "?";
  els.peerAvatar.textContent=letter; els.infoAvatar.textContent=letter;
  els.infoPeer.textContent=on ? remotePeer : "Not connected"; els.infoPeerAddress.textContent=on ? remotePeer : "—";
}
function showTab(name) {
  els.nav.forEach(b=>b.classList.toggle("active",b.dataset.tab===name));
  els.tabs.forEach(t=>t.classList.toggle("active",t.id===`tab-${name}`));
  els.sidebar.classList.remove("open");
}
els.nav.forEach(b=>b.onclick=()=>showTab(b.dataset.tab));
els.openSettings.onclick=()=>showTab("settings");
els.menuBtn.onclick=()=>els.sidebar.classList.toggle("open");
els.closeMenuBtn.onclick=()=>els.sidebar.classList.remove("open");
document.addEventListener("keydown",e=>{if(e.key==="Escape")els.sidebar.classList.remove("open")});
document.addEventListener("click",e=>{
  if(window.innerWidth<=900 && els.sidebar.classList.contains("open") && !els.sidebar.contains(e.target) && e.target!==els.menuBtn){
    els.sidebar.classList.remove("open");
  }
});

async function copyId() { await navigator.clipboard.writeText(peerId); toast("AlfaShare address copied"); }
els.copySideId.onclick=copyId; els.copySettingsId.onclick=copyId;

function signal(to,data) { socket.emit("signal",{to,data}); }

function makePC(id, initiator) {
  if (pc) pc.close();
  pendingCandidates=[];
  pc=new RTCPeerConnection({iceServers:ICE});
  pc.onicecandidate=e=>e.candidate && signal(id,{type:"candidate",candidate:e.candidate});
  pc.onconnectionstatechange=()=>{
    if(pc.connectionState==="connected") {
      setStatus("P2P Connected",true); setConnection(true); toast("Direct connection established");
    }
    if(["failed","disconnected","closed"].includes(pc.connectionState)) disconnect(false);
  };
  pc.ondatachannel=e=>bindChannel(e.channel);
  if(initiator) bindChannel(pc.createDataChannel("alfashare"));
  return pc;
}
function bindChannel(dc) {
  channel=dc; channel.binaryType="arraybuffer"; channel.bufferedAmountLowThreshold=LOW_WATER;
  channel.onopen=()=>{setStatus("P2P Connected",true);setConnection(true);};
  channel.onclose=()=>disconnect(false);
  channel.onerror=()=>toast("Data channel error");
  channel.onmessage=onChannel;
}
async function connectPeer() {
  const target=els.remote.value.trim().toUpperCase();
  if(!socket?.connected) return els.connectMessage.textContent="Signaling server is offline.";
  if(!/^[A-Z0-9]{8,32}$/.test(target)) return els.connectMessage.textContent="Enter a valid 8–32 character AlfaShare address.";
  if(target===peerId) return els.connectMessage.textContent="You cannot connect to your own address.";
  remotePeer=target; els.connectMessage.textContent="Negotiating direct connection…";
  makePC(target,true);
  const offer=await pc.createOffer();
  await pc.setLocalDescription(offer);
  signal(target,{type:"offer",sdp:pc.localDescription});
}
function normalizePeer(value){
  return String(value||"").toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,32);
}
function openQuickConnect(){
  const value=window.prompt("Enter the other person's AlfaShare address:", els.remote.value || "");
  if(value===null)return;
  els.remote.value=normalizePeer(value);
  els.connectMessage.textContent=els.remote.value ? "Address entered. Press Connect." : "No address entered.";
  if(els.remote.value) els.connect.focus();
}
els.connect.onclick=connectPeer;
els.remote.onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();connectPeer();}};
els.remote.oninput=e=>{ e.target.value=normalizePeer(e.target.value); };
els.remote.onpaste=()=>setTimeout(()=>{els.remote.value=normalizePeer(els.remote.value)},0);
els.remote.onfocus=()=>{ els.connectMessage.textContent="Ready — type or paste a peer address."; };
els.pastePeerBtn.onclick=async()=>{
  try{
    const text=await navigator.clipboard.readText();
    els.remote.value=normalizePeer(text);
    els.remote.focus();
    els.connectMessage.textContent=els.remote.value?"Address pasted. Press Connect.":"Clipboard is empty.";
  }catch{
    openQuickConnect();
  }
};
els.quickConnectBtn.onclick=openQuickConnect;

async function onSignal({from,data}) {
  remotePeer=from;
  try {
    if(data.type==="offer") {
      makePC(from,false);
      await pc.setRemoteDescription(data.sdp);
      const answer=await pc.createAnswer();
      await pc.setLocalDescription(answer);
      signal(from,{type:"answer",sdp:pc.localDescription});
    } else if(data.type==="answer") {
      if(!pc) makePC(from,true);
      await pc.setRemoteDescription(data.sdp);
    } else if(data.type==="candidate") {
      if(pc?.remoteDescription) await pc.addIceCandidate(data.candidate);
      else pendingCandidates.push(data.candidate);
    }
    if(pc?.remoteDescription && pendingCandidates.length) {
      for(const c of pendingCandidates) await pc.addIceCandidate(c);
      pendingCandidates=[];
    }
  } catch(e) { console.error(e); els.connectMessage.textContent="WebRTC negotiation failed."; disconnect(false); }
}

function disconnect(show=true) {
  try{channel?.close()}catch{}
  try{pc?.close()}catch{}
  channel=null;pc=null;remotePeer=null;incoming.clear();outgoing.clear();setConnection(false);setStatus(socket?.connected?"Connected to server":"Disconnected",socket?.connected);
  if(show) els.connectMessage.textContent="Disconnected.";
}

function send(payload) {
  if(!channel || channel.readyState!=="open") throw Error("Not connected");
  channel.send(JSON.stringify(payload));
}

function resetWelcome() { document.querySelector(".welcome-chat")?.remove(); }

function addMessage(text,mine=false,kind="text") {
  resetWelcome();
  const row=document.createElement("div"); row.className=`message ${mine?"mine":""}`;
  const bubble=document.createElement("div"); bubble.className="bubble";
  if(kind==="gif") { const img=document.createElement("img"); img.src=text; img.alt="GIF"; img.loading="lazy"; bubble.appendChild(img); }
  else bubble.appendChild(document.createTextNode(text));
  const meta=document.createElement("div"); meta.className="meta"; meta.textContent=mine?"You":(remotePeer||"Peer");
  bubble.appendChild(meta);row.appendChild(bubble);els.messages.appendChild(row);els.messages.scrollTop=els.messages.scrollHeight;
}

els.chatForm.onsubmit=e=>{e.preventDefault();const text=els.chatInput.value.trim();if(!text)return;try{send({kind:"chat",text,at:Date.now()});addMessage(text,true);els.chatInput.value="";}catch{toast("Connect to a peer first");}};

const emojis="😀 😃 😄 😁 😆 😅 😂 🙂 🙃 😉 😊 😍 🥰 😘 😎 🤩 🤔 😮 😢 😭 😡 🤯 ❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 👍 👎 👏 🙌 🔥 ✨ 🎉 🎯 🚀 💯 👋 🙏 😂 🤝 😴 🤗".split(" ");
emojis.forEach(e=>{const b=document.createElement("button");b.type="button";b.textContent=e;b.onclick=()=>els.chatInput.value+=e;els.emojiPanel.appendChild(b);});
els.emojiBtn.onclick=()=>{els.emojiPanel.classList.toggle("hidden");els.gifPanel.classList.add("hidden")};
els.gifBtn.onclick=()=>{els.gifPanel.classList.toggle("hidden");els.emojiPanel.classList.add("hidden")};
els.sendGif.onclick=()=>{const url=els.gifUrl.value.trim();if(!/^https?:\/\/.+/i.test(url))return toast("Paste a valid GIF URL");try{send({kind:"gif",url});addMessage(url,true,"gif");els.gifUrl.value="";}catch{toast("Connect to a peer first")}};

async function gifSearch(q) {
  if(!q) return;
  try {
    const r=await fetch(`/api/gifs?q=${encodeURIComponent(q)}`);
    const data=await r.json();
    els.gifResults.innerHTML="";
    (data.results||[]).forEach(item=>{
      const img=document.createElement("img");img.src=item.preview;img.title=item.title||"GIF";
      img.onclick=()=>{els.gifUrl.value=item.url;els.gifUrl.focus()};els.gifResults.appendChild(img);
    });
  } catch {}
}
els.gifUrl.addEventListener("input",e=>{ if(!e.target.value.includes("http") && e.target.value.length>2) gifSearch(e.target.value); });

function transferUI(name,direction) {
  const box=document.createElement("div");box.className="transfer-item";
  const line=document.createElement("div");line.className="transfer-line";
  const b=document.createElement("b");b.textContent=`${direction==="in"?"Receiving":"Sending"} • ${name}`;
  const pct=document.createElement("span");pct.textContent="0%";line.append(b,pct);
  const bar=document.createElement("div");bar.className="bar";const i=document.createElement("i");bar.appendChild(i);box.append(line,bar);els.transfers.prepend(box);
  return {box,pct,i};
}
function addHistory(name,size,direction) {
  const history=JSON.parse(localStorage.getItem("alfashare-history")||"[]");
  history.unshift({name,size,direction,time:new Date().toISOString()});
  localStorage.setItem("alfashare-history",JSON.stringify(history.slice(0,100)));
  renderHistory();
}
function fmtSize(n){if(n<1024)return `${n} B`;const u=["KB","MB","GB","TB"];let i=-1;do{n/=1024;i++}while(n>=1024&&i<u.length-1);return `${n.toFixed(n>=100?0:1)} ${u[i]}`}
function renderHistory() {
  const h=JSON.parse(localStorage.getItem("alfashare-history")||"[]");els.history.innerHTML="";
  if(!h.length){els.history.innerHTML='<div class="empty-history">No transfer history yet.</div>';return;}
  h.forEach(x=>{const d=document.createElement("div");d.className="history-item";d.innerHTML=`<div class="history-icon">${x.direction==="sent"?"⇧":"⇩"}</div><div><b></b><small></small></div>`;d.querySelector("b").textContent=x.name;d.querySelector("small").textContent=`${x.direction==="sent"?"Sent":"Received"} • ${fmtSize(x.size)} • ${new Date(x.time).toLocaleString()}`;els.history.appendChild(d)});
}
renderHistory();
els.clearHistory.onclick=()=>{localStorage.removeItem("alfashare-history");renderHistory();toast("Transfer history cleared")};

async function waitForBuffer() {
  if(channel.bufferedAmount<=HIGH_WATER)return;
  await new Promise(resolve=>{
    const done=()=>{channel.removeEventListener("bufferedamountlow",done);resolve()};
    channel.addEventListener("bufferedamountlow",done,{once:true});
  });
}
async function sendFile(file) {
  if(!channel||channel.readyState!=="open")return toast("Connect a peer first.");
  const id=crypto.randomUUID(), total=Math.ceil(file.size/CHUNK), ui=transferUI(file.name,"out");
  outgoing.set(id,{file,ui,total,start:performance.now()});
  send({kind:"file-start",id,name:file.name,size:file.size,type:file.type||"application/octet-stream",total});
  for(let index=0,offset=0;offset<file.size;index++,offset+=CHUNK) {
    await waitForBuffer();
    const buf=await file.slice(offset,offset+CHUNK).arrayBuffer();
    // Robust protocol: metadata JSON first, then exactly one binary chunk.
    send({kind:"file-chunk",id,index});
    channel.send(buf);
    const pct=Math.round(((index+1)/total)*100);ui.i.style.width=pct+"%";ui.pct.textContent=pct+"%";
    const elapsed=(performance.now()-outgoing.get(id).start)/1000;
    const mbps=elapsed?((Math.min(offset+CHUNK,file.size)/1024/1024)/elapsed):0;
    els.speedStat.textContent=`${mbps.toFixed(1)} MB/s`;
  }
  send({kind:"file-end",id});ui.pct.textContent="Sent";addHistory(file.name,file.size,"sent");outgoing.delete(id);
}
function onChannel(e) {
  if(typeof e.data==="string") {
    let m;try{m=JSON.parse(e.data)}catch{return}
    if(m.kind==="chat")addMessage(m.text,false);
    if(m.kind==="gif")addMessage(m.url,false,"gif");
    if(m.kind==="file-start") {
      const ui=transferUI(m.name,"in");
      incoming.set(m.id,{meta:m,chunks:new Array(m.total),received:0,ui,expected:null});
    }
    if(m.kind==="file-chunk") {
      const item=incoming.get(m.id);
      if(item)item.expected=m.index;
    }
    if(m.kind==="file-end")finishFile(m.id);
  } else {
    // Binary message belongs to the chunk metadata immediately preceding it.
    const item=[...incoming.values()].find(x=>x.expected!==null);
    if(!item)return;
    item.chunks[item.expected]=e.data;
    item.received++;
    item.expected=null;
    const pct=Math.round((item.received/item.meta.total)*100);item.ui.i.style.width=pct+"%";item.ui.pct.textContent=pct+"%";
  }
}
function finishFile(id) {
  const item=incoming.get(id);if(!item)return;
  if(item.received!==item.meta.total){item.ui.pct.textContent=`Incomplete (${item.received}/${item.meta.total})`;incoming.delete(id);return;}
  const blob=new Blob(item.chunks,{type:item.meta.type});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=item.meta.name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
  item.ui.pct.textContent="Received";addHistory(item.meta.name,item.meta.size,"received");toast(`Received ${item.meta.name}`);incoming.delete(id);
}

els.chooseFiles.onclick=()=>els.fileInput.click();
els.dropzone.onclick=e=>{if(!e.target.closest("button"))els.fileInput.click()};
els.fileInput.onchange=()=>[...els.fileInput.files].forEach(sendFile);
["dragenter","dragover"].forEach(x=>els.dropzone.addEventListener(x,e=>{e.preventDefault();els.dropzone.classList.add("drag")}));
["dragleave","drop"].forEach(x=>els.dropzone.addEventListener(x,e=>{e.preventDefault();els.dropzone.classList.remove("drag")}));
els.dropzone.addEventListener("drop",e=>[...e.dataTransfer.files].forEach(sendFile));
els.chatDisconnect.onclick=()=>disconnect();

els.themes.querySelectorAll("button").forEach(b=>b.onclick=()=>{
  document.documentElement.dataset.theme=b.dataset.theme;
  localStorage.setItem("alfashare-theme",b.dataset.theme);
  els.themes.querySelectorAll("button").forEach(x=>x.classList.toggle("active",x===b));
});
const savedTheme=localStorage.getItem("alfashare-theme")||"dark";document.documentElement.dataset.theme=savedTheme;
els.themes.querySelectorAll("button").forEach(b=>b.classList.toggle("active",b.dataset.theme===savedTheme));


let deferredInstallPrompt=null;
window.addEventListener("beforeinstallprompt", e=>{
  e.preventDefault(); deferredInstallPrompt=e;
  els.installBtn.disabled=false; els.installStatus.textContent="Ready to install";
});
window.addEventListener("appinstalled", ()=>{
  deferredInstallPrompt=null;
  els.installBtn.disabled=true; els.installStatus.textContent="Installed ✓";
  toast("AlfaShare installed");
});
els.installBtn.onclick=async()=>{
  if(deferredInstallPrompt){
    deferredInstallPrompt.prompt();
    const choice=await deferredInstallPrompt.userChoice;
    deferredInstallPrompt=null;
    els.installStatus.textContent=choice.outcome==="accepted"?"Installed ✓":"Install cancelled";
  }else{
    els.installStatus.textContent="Use your browser menu → Install app / Add to Home screen";
    toast("Open browser menu to install AlfaShare");
  }
};

function startSocket() {
  setStatus("Connecting…");
  socket=io({transports:["websocket","polling"],reconnection:true});
  socket.on("connect",()=>{
    els.serverText.textContent="Signaling connected";setStatus("Server Connected",true);
    socket.emit("register",peerId,result=>{
      if(!result?.ok){localStorage.removeItem("alfashare-peer-id");peerId=loadPeerId();setIds();socket.emit("register",peerId)}
      els.connectMessage.textContent="Ready. Enter a peer address.";
    });
  });
  socket.on("disconnect",()=>{els.serverText.textContent="Signaling offline";if(!channel)setStatus("Disconnected")});
  socket.on("connect_error",()=>{els.serverText.textContent="Cannot reach server";if(!channel)setStatus("Disconnected")});
  socket.on("signal",onSignal);
}
if("serviceWorker"in navigator){
  navigator.serviceWorker.register("/sw.js").then(reg=>{
    reg.update();
  }).catch(console.warn);
}
startSocket();
})();
