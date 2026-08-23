# AlfaShare 4.0

Fast, private, direct peer-to-peer chat and large-file sharing.

## Highlights
- Stable 8-character peer code stored in browser local storage.
- Peer display name and recent peer contacts stored locally.
- Offline-peer check before starting a WebRTC offer.
- WebRTC DataChannel for chat and file bytes; Socket.IO is signaling only.
- 64 KiB chunks with high-water backpressure and 8 MiB ACK windows.
- OPFS-backed receiving on supported browsers to avoid assembling large files in RAM.
- Transfer speed, progress and ETA.
- Chat message history per peer.
- Camera/file attachments and pasted images.
- Responsive WhatsApp-inspired chat UI.
- PWA with cache versioning and install support.
- No database and no server-side file storage.

## Run
```bash
npm install
npm start
```

The signaling server uses `PORT` supplied by the hosting provider. Files are not sent through Socket.IO.

## Notes
Direct P2P is subject to NAT/firewall conditions. STUN is configured; some restrictive networks require a TURN relay for connectivity.
