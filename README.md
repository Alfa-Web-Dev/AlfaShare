# AlfaShare 2.2

Professional self-hosted P2P chat + file sharing PWA.

## Run

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## Important: Internet-wide sharing

The application is self-hosted, but for two people on different networks the signaling server must be reachable from the Internet. Use a public domain/IP with HTTPS/WSS. STUN helps direct NAT traversal. Some networks require TURN for a guaranteed connection; that can also be self-hosted.

## The previous incomplete-transfer bug

The old build could lose binary chunks because JSON metadata and binary messages were handled in the wrong order. AlfaShare 2.2 uses a strict protocol:

1. file-start metadata
2. file-chunk metadata
3. exactly one binary chunk
4. repeat
5. file-end

It also increases the chunk size from 16 KB to 64 KB and uses a WebRTC backpressure threshold to improve throughput without flooding browser memory.

## GIFs

GIF URLs can be sent directly. Optional searchable GIF support is available through `/api/gifs` when `GIPHY_API_KEY` is configured. No key is hard-coded.

## PWA

The app includes `manifest.json` and `sw.js`. The app shell can be installed and cached, while signaling remains network-dependent.


## 2.2 UI/UX updates
- Added 12 color themes: Dark, White, Blue, Green, Pink, Red, Neon, Purple, Orange, Cyan, Sunset and Violet.
- Added PWA install flow and app shortcuts.
- Hardened text input interaction and added a native Quick Type fallback for environments where normal paste/input is blocked.
- Service worker cache is versioned to prevent stale UI after updates.
