# AlfaShare 3.0

Simple, fast and private peer-to-peer chat and large-file sharing.

## Architecture
- Node.js + Express + Socket.IO for signaling only.
- WebRTC DataChannel for chat and file bytes.
- STUN for NAT traversal.
- No database and no cloud file storage.
- PWA manifest + service worker.

## Large-file mode
Files are sent as ordered 64 KB chunks with WebRTC backpressure and acknowledgements. On browsers supporting Origin Private File System (OPFS), received chunks are written incrementally to local storage instead of keeping the whole file in RAM.

For the best large-file experience, use a current Chromium-based browser. Direct P2P still depends on the two networks being able to establish a WebRTC route; this build intentionally does not add a paid TURN relay.

## Run
```bash
npm install
npm start
```
Open `http://localhost:3000`.
