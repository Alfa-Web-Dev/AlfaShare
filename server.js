const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    transports: ["websocket", "polling"],
    cors: {
        origin: "*"
    }
});

const PORT = process.env.PORT || 3000;

/*
    AlfaShare Signaling Server

    IMPORTANT:
    This server DOES NOT receive or store:
    - files
    - chat messages
    - file chunks

    It only helps two peers find each other
    and exchange WebRTC signaling information.
*/

const peers = new Map();

/* Serve frontend */
app.use(express.static(path.join(__dirname, "public")));

/* -----------------------------
   Socket.IO
----------------------------- */

io.on("connection", (socket) => {

    console.log("Socket connected:", socket.id);

    /*
        Register peer
    */
    socket.on("peer:register", (data) => {

        if (!data || !data.peerId) {
            return;
        }

        const peerId = String(data.peerId);

        const profile = {
            name: String(data.name || "AlfaShare User").slice(0, 50)
        };

        /*
            If the same device reconnects,
            remove its old socket.
        */

        const oldPeer = peers.get(peerId);

        if (oldPeer && oldPeer.socketId !== socket.id) {

            const oldSocket = io.sockets.sockets.get(
                oldPeer.socketId
            );

            if (oldSocket) {
                oldSocket.emit("peer:replaced");
                oldSocket.disconnect(true);
            }
        }

        peers.set(peerId, {
            socketId: socket.id,
            profile: profile,
            connectedAt: Date.now()
        });

        socket.data.peerId = peerId;

        console.log("Peer registered:", peerId);

        socket.emit("peer:registered", {
            peerId
        });

        /*
            Notify other connected clients
            that this peer is online.
        */

        socket.broadcast.emit("peer:presence", {
            peerId,
            online: true,
            profile
        });
    });


    /*
        Check whether another peer is online
    */

    socket.on("peer:lookup", (data) => {

        if (!data || !data.peerId) {
            return;
        }

        const peerId = String(data.peerId);

        const peer = peers.get(peerId);

        socket.emit("peer:lookupResult", {

            peerId,

            online: Boolean(peer),

            profile: peer
                ? peer.profile
                : null
        });
    });


    /*
        WebRTC OFFER
    */

    socket.on("signal:offer", (data) => {

        if (!data || !data.to) {
            return;
        }

        const target = peers.get(String(data.to));

        if (!target) {

            socket.emit("signal:offline", {
                peerId: data.to
            });

            return;
        }

        io.to(target.socketId).emit(
            "signal:offer",
            data
        );
    });


    /*
        WebRTC ANSWER
    */

    socket.on("signal:answer", (data) => {

        if (!data || !data.to) {
            return;
        }

        const target = peers.get(String(data.to));

        if (!target) {

            socket.emit("signal:offline", {
                peerId: data.to
            });

            return;
        }

        io.to(target.socketId).emit(
            "signal:answer",
            data
        );
    });


    /*
        ICE candidate
    */

    socket.on("signal:ice", (data) => {

        if (!data || !data.to) {
            return;
        }

        const target = peers.get(String(data.to));

        if (!target) {
            return;
        }

        io.to(target.socketId).emit(
            "signal:ice",
            data
        );
    });


    /*
        Connection restart / ICE restart
    */

    socket.on("signal:restart", (data) => {

        if (!data || !data.to) {
            return;
        }

        const target = peers.get(String(data.to));

        if (!target) {

            socket.emit("signal:offline", {
                peerId: data.to
            });

            return;
        }

        io.to(target.socketId).emit(
            "signal:restart",
            data
        );
    });


    /*
        Socket disconnected
    */

    socket.on("disconnect", () => {

        const peerId = socket.data.peerId;

        if (!peerId) {
            return;
        }

        const peer = peers.get(peerId);

        /*
            Only remove this peer if this socket
            is still the active connection.
        */

        if (
            peer &&
            peer.socketId === socket.id
        ) {

            peers.delete(peerId);

            console.log(
                "Peer disconnected:",
                peerId
            );

            socket.broadcast.emit(
                "peer:presence",
                {
                    peerId,
                    online: false
                }
            );
        }
    });
});


/*
    SPA fallback
*/

app.get("*", (req, res) => {

    res.sendFile(
        path.join(
            __dirname,
            "public",
            "index.html"
        )
    );
});


/*
    Start server
*/

server.listen(PORT, () => {

    console.log("");
    console.log("=================================");
    console.log("       AlfaShare Server");
    console.log("=================================");
    console.log(`Running on port ${PORT}`);
    console.log("Signaling only");
    console.log("No file storage");
    console.log("No chat storage");
    console.log("=================================");
    console.log("");
});
