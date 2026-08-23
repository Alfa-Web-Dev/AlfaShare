const path = require("path");
const crypto = require("crypto");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, credentials: false },
  maxHttpBufferSize: 2 * 1024 * 1024
});

app.disable("x-powered-by");
app.use(express.json({ limit: "64kb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/gifs", async (req, res) => {
  const key = process.env.GIPHY_API_KEY;
  const q = String(req.query.q || "").trim().slice(0, 80);
  if (!key || !q) return res.json({ results: [] });
  try {
    const url = new URL("https://api.giphy.com/v1/gifs/search");
    url.searchParams.set("api_key", key);
    url.searchParams.set("q", q);
    url.searchParams.set("limit", "12");
    url.searchParams.set("rating", "pg-13");
    const response = await fetch(url);
    if (!response.ok) return res.json({ results: [] });
    const data = await response.json();
    const results = (data.data || []).map(g => ({
      title: g.title || "GIF",
      url: g.images?.original?.url || "",
      preview: g.images?.fixed_width_small?.url || g.images?.downsized_small?.url || ""
    })).filter(x => x.url && x.preview);
    res.json({ results });
  } catch {
    res.json({ results: [] });
  }
});

const peers = new Map();

function validPeerId(id) {
  return /^[A-Z0-9]{8,32}$/.test(id);
}

io.on("connection", socket => {
  socket.on("register", (rawId, profile, ack) => {
    if (typeof profile === "function") { ack = profile; profile = {}; }
    const peerId = String(rawId || "").trim().toUpperCase();
    if (!validPeerId(peerId)) return ack?.({ ok: false, error: "Invalid peer ID." });
    if (peers.has(peerId)) return ack?.({ ok: false, error: "Peer ID already in use." });

    socket.data.peerId = peerId;
    socket.data.name = String(profile?.name || "AlfaShare user").trim().slice(0, 40) || "AlfaShare user";
    peers.set(peerId, socket.id);
    ack?.({ ok: true, peerId, name: socket.data.name });
    socket.emit("registered", { peerId });
  });

  socket.on("check-peer", (rawId, ack) => {
    const id = String(rawId || "").trim().toUpperCase();
    const target = peers.get(id);
    if (!target) return ack?.({ online: false, peerId: id });
    const targetSocket = io.sockets.sockets.get(target);
    ack?.({ online: !!targetSocket, peerId: id, name: targetSocket?.data?.name || "AlfaShare user" });
  });

  socket.on("signal", ({ to, data }) => {
    const from = socket.data.peerId;
    const targetId = String(to || "").toUpperCase();
    const target = peers.get(targetId);
    if (!from || !target || !data) {
      socket.emit("peer-offline", { peerId: targetId });
      return;
    }
    io.to(target).emit("signal", { from, name: socket.data.name || "AlfaShare user", data });
  });

  socket.on("disconnect", () => {
    const id = socket.data.peerId;
    if (id && peers.get(id) === socket.id) peers.delete(id);
  });
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", peers: peers.size, service: "AlfaShare signaling" });
});

app.get("*splat", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

server.listen(PORT, HOST, () => {
  console.log(`AlfaShare signaling server listening on http://${HOST}:${PORT}`);
});
