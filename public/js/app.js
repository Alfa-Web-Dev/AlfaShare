/* =========================================================
   AlfaShare — Core P2P Application
   ========================================================= */

(() => {
    "use strict";

    /* =====================================================
       CONFIG
    ===================================================== */

    const CHUNK_SIZE = 64 * 1024;

    const MAX_BUFFERED_AMOUNT = 16 * 1024 * 1024;

    const BUFFERED_LOW_THRESHOLD = 512 * 1024;

    const ICE_SERVERS = [
        {
            urls: [
                "stun:stun.l.google.com:19302",
                "stun:stun1.l.google.com:19302"
            ]
        }
    ];

    const STORAGE_KEYS = {
        peerId: "alfashare_peer_id",
        name: "alfashare_name",
        theme: "alfashare_theme",
        history: "alfashare_transfer_history",
        contacts: "alfashare_contacts"
    };


    /* =====================================================
       DOM
    ===================================================== */

    const $ = (selector) =>
        document.querySelector(selector);


    const $$ = (selector) =>
        Array.from(document.querySelectorAll(selector));


    const connectionStatus =
        $("#connectionStatus");

    const connectionDot =
        $("#connectionDot");

    const peerCodeInput =
        $("#peerCodeInput");

    const connectBtn =
        $("#connectBtn");

    const disconnectBtn =
        $("#disconnectBtn");

    const connectedPeer =
        $("#connectedPeer");

    const connectedPeerName =
        $("#connectedPeerName");

    const connectedPeerStatus =
        $("#connectedPeerStatus");

    const chooseFileBtn =
        $("#chooseFileBtn");

    const fileInput =
        $("#fileInput");

    const dropZone =
        $("#dropZone");

    const transferList =
        $("#transferList");

    const clearTransfersBtn =
        $("#clearTransfersBtn");

    const messages =
        $("#messages");

    const messageInput =
        $("#messageInput");

    const sendMessageBtn =
        $("#sendMessageBtn");

    const emojiBtn =
        $("#emojiBtn");

    const emojiPanel =
        $("#emojiPanel");

    const chatFileBtn =
        $("#chatFileBtn");

    const nameInput =
        $("#nameInput");

    const profileAvatar =
        $("#profileAvatar");

    const myPeerCode =
        $("#myPeerCode");

    const copyPeerCodeBtn =
        $("#copyPeerCodeBtn");

    const chatPeerName =
        $("#chatPeerName");

    const chatPeerStatus =
        $("#chatPeerStatus");

    const toast =
        $("#toast");


    /* =====================================================
       STATE
    ===================================================== */

    let socket = null;

    let myPeerId = null;

    let myName = null;

    let remotePeerId = null;

    let remotePeerName = null;

    let peerConnection = null;

    let dataChannel = null;

    let isInitiator = false;

    let pendingCandidates = [];

    let reconnectTimer = null;

    let toastTimer = null;

    let transferCounter = 0;

    const incomingTransfers = new Map();

    const outgoingTransfers = new Map();


    /* =====================================================
       UTILITY
    ===================================================== */

    function showToast(message) {

        if (!toast) return;

        toast.textContent = message;

        toast.classList.add("show");

        clearTimeout(toastTimer);

        toastTimer = setTimeout(() => {

            toast.classList.remove("show");

        }, 2800);
    }


    function safeJSONParse(value, fallback = null) {

        try {

            return JSON.parse(value);

        } catch {

            return fallback;
        }
    }


    function loadStorage(key, fallback = null) {

        try {

            const value =
                localStorage.getItem(key);

            if (value === null) {
                return fallback;
            }

            return value;

        } catch {

            return fallback;
        }
    }


    function saveStorage(key, value) {

        try {

            localStorage.setItem(
                key,
                value
            );

        } catch (error) {

            console.warn(
                "Storage error:",
                error
            );
        }
    }


    function generatePeerId() {

        const bytes =
            new Uint8Array(6);

        crypto.getRandomValues(bytes);

        return Array.from(bytes)
            .map(byte =>
                byte
                    .toString(36)
                    .padStart(2, "0")
            )
            .join("")
            .slice(0, 8)
            .toUpperCase();
    }


    function getStablePeerId() {

        let id =
            loadStorage(
                STORAGE_KEYS.peerId
            );

        if (
            !id ||
            typeof id !== "string"
        ) {

            id = generatePeerId();

            saveStorage(
                STORAGE_KEYS.peerId,
                id
            );
        }

        return id;
    }


    function getName() {

        const saved =
            loadStorage(
                STORAGE_KEYS.name
            );

        return (
            saved &&
            saved.trim()
        )
            ? saved.trim()
            : "AlfaShare User";
    }


    function formatBytes(bytes) {

        if (!Number.isFinite(bytes)) {
            return "0 B";
        }

        if (bytes < 1024) {
            return `${bytes} B`;
        }

        if (bytes < 1024 * 1024) {
            return `${(
                bytes / 1024
            ).toFixed(1)} KB`;
        }

        if (bytes < 1024 * 1024 * 1024) {
            return `${(
                bytes /
                (1024 * 1024)
            ).toFixed(1)} MB`;
        }

        return `${(
            bytes /
            (1024 * 1024 * 1024)
        ).toFixed(2)} GB`;
    }


    function formatTime() {

        return new Date()
            .toLocaleTimeString(
                [],
                {
                    hour: "2-digit",
                    minute: "2-digit"
                }
            );
    }


    function setConnectionState(
        state,
        text
    ) {

        if (connectionStatus) {
            connectionStatus.textContent =
                text;
        }

        if (!connectionDot) {
            return;
        }

        connectionDot.classList.remove(
            "online",
            "offline"
        );

        if (state === "online") {

            connectionDot.classList.add(
                "online"
            );

        } else if (
            state === "offline"
        ) {

            connectionDot.classList.add(
                "offline"
            );
        }
    }


    /* =====================================================
       LOCAL PROFILE
    ===================================================== */

    function initializeProfile() {

        myPeerId =
            getStablePeerId();

        myName =
            getName();

        if (myPeerCode) {

            myPeerCode.textContent =
                myPeerId;
        }

        if (nameInput) {

            nameInput.value =
                myName;
        }

        updateAvatar();
    }


    function updateAvatar() {

        const firstLetter =
            (
                myName ||
                "A"
            )
                .trim()
                .charAt(0)
                .toUpperCase();

        if (profileAvatar) {

            profileAvatar.textContent =
                firstLetter;
        }
    }


    if (nameInput) {

        nameInput.addEventListener(
            "input",
            () => {

                myName =
                    nameInput.value
                        .trim()
                        .slice(0, 40);

                if (!myName) {
                    myName =
                        "AlfaShare User";
                }

                saveStorage(
                    STORAGE_KEYS.name,
                    myName
                );

                updateAvatar();

                /*
                    If already connected,
                    update remote profile
                    without sending through
                    the signaling server.
                */

                sendData({
                    type: "profile",
                    name: myName
                });
            }
        );
    }


    /* =====================================================
       THEME
    ===================================================== */

    function initializeTheme() {

        const theme =
            loadStorage(
                STORAGE_KEYS.theme,
                "dark"
            );

        applyTheme(theme);
    }


    function applyTheme(theme) {

        document.body.classList.remove(
            "theme-light",
            "theme-blue",
            "theme-green",
            "theme-pink",
            "theme-red",
            "theme-neon"
        );

        if (
            theme &&
            theme !== "dark"
        ) {

            document.body.classList.add(
                `theme-${theme}`
            );
        }

        $$(".theme-option")
            .forEach(button => {

                button.classList.toggle(
                    "active",
                    button.dataset.theme ===
                    theme
                );
            });

        saveStorage(
            STORAGE_KEYS.theme,
            theme
        );
    }


    $$(".theme-option")
        .forEach(button => {

            button.addEventListener(
                "click",
                () => {

                    applyTheme(
                        button.dataset.theme
                    );
                }
            );
        });


    /* =====================================================
       NAVIGATION
    ===================================================== */

    $$(".nav-item")
        .forEach(button => {

            button.addEventListener(
                "click",
                () => {

                    const pageId =
                        button.dataset.page;

                    $$(".nav-item")
                        .forEach(item => {

                            item.classList.toggle(
                                "active",
                                item === button
                            );
                        });

                    $$(".page")
                        .forEach(page => {

                            page.classList.toggle(
                                "active",
                                page.id === pageId
                            );
                        });
                }
            );
        });


    /* =====================================================
       SOCKET CONNECTION
    ===================================================== */

    function connectSocket() {

        if (typeof io !== "function") {

            showToast(
                "Socket.IO failed to load"
            );

            setConnectionState(
                "offline",
                "Server unavailable"
            );

            return;
        }

        setConnectionState(
            "connecting",
            "Connecting..."
        );

        socket = io({
            transports: [
                "websocket",
                "polling"
            ],

            reconnection: true,

            reconnectionAttempts: Infinity,

            reconnectionDelay: 1000,

            reconnectionDelayMax: 5000,

            timeout: 10000
        });


        socket.on(
            "connect",
            () => {

                console.log(
                    "Signaling connected"
                );

                setConnectionState(
                    "online",
                    "Server connected"
                );

                registerPeer();
            }
        );


        socket.on(
            "disconnect",
            () => {

                setConnectionState(
                    "offline",
                    "Server disconnected"
                );

                /*
                    Do not destroy the peer ID.

                    The ID stays in localStorage,
                    therefore refresh does NOT create
                    a new code.
                */

                scheduleReconnect();
            }
        );


        socket.on(
            "connect_error",
            error => {

                console.warn(
                    "Socket connection error:",
                    error.message
                );

                setConnectionState(
                    "offline",
                    "Server unavailable"
                );
            }
        );


        socket.on(
            "peer:registered",
            data => {

                if (
                    data &&
                    data.peerId
                ) {

                    myPeerId =
                        data.peerId;

                    if (myPeerCode) {

                        myPeerCode.textContent =
                            myPeerId;
                    }
                }
            }
        );


        socket.on(
            "peer:replaced",
            () => {

                showToast(
                    "This AlfaShare session was opened somewhere else."
                );
            }
        );


        socket.on(
            "peer:presence",
            data => {

                if (
                    !data ||
                    !remotePeerId
                ) {
                    return;
                }

                if (
                    data.peerId ===
                    remotePeerId
                ) {

                    updateRemotePresence(
                        Boolean(data.online)
                    );
                }
            }
        );


        socket.on(
            "peer:lookupResult",
            data => {

                if (
                    !data ||
                    data.peerId !==
                    remotePeerId
                ) {
                    return;
                }

                if (!data.online) {

                    handlePeerOffline();

                    return;
                }

                if (
                    data.profile &&
                    data.profile.name
                ) {

                    remotePeerName =
                        data.profile.name;

                    updatePeerUI();
                }
            }
        );


        socket.on(
            "signal:offline",
            data => {

                if (
                    data &&
                    data.peerId ===
                    remotePeerId
                ) {

                    handlePeerOffline();
                }
            }
        );


        socket.on(
            "signal:offer",
            async data => {

                if (!data) return;

                try {

                    await handleOffer(
                        data
                    );

                } catch (error) {

                    console.error(
                        "Offer error:",
                        error
                    );

                    showToast(
                        "Connection request failed"
                    );
                }
            }
        );


        socket.on(
            "signal:answer",
            async data => {

                if (!data) return;

                try {

                    await handleAnswer(
                        data
                    );

                } catch (error) {

                    console.error(
                        "Answer error:",
                        error
                    );

                    showToast(
                        "Connection response failed"
                    );
                }
            }
        );


        socket.on(
            "signal:ice",
            async data => {

                if (!data) return;

                try {

                    await handleIce(
                        data
                    );

                } catch (error) {

                    console.warn(
                        "ICE error:",
                        error
                    );
                }
            }
        );
    }


    function registerPeer() {

        if (
            !socket ||
            !socket.connected
        ) {
            return;
        }

        socket.emit(
            "peer:register",
            {
                peerId: myPeerId,
                name: myName
            }
        );
    }


    function scheduleReconnect() {

        clearTimeout(
            reconnectTimer
        );

        reconnectTimer =
            setTimeout(() => {

                if (
                    socket &&
                    !socket.connected
                ) {

                    socket.connect();
                }

            }, 2500);
    }


    /* =====================================================
       CONNECT TO PEER
    ===================================================== */

    connectBtn.addEventListener(
        "click",
        connectToPeer
    );


    peerCodeInput.addEventListener(
        "keydown",
        event => {

            if (
                event.key ===
                "Enter"
            ) {

                connectToPeer();
            }
        }
    );


    function connectToPeer() {

        const target =
            peerCodeInput.value
                .trim()
                .toUpperCase()
                .replace(
                    /[^A-Z0-9]/g,
                    ""
                );


        if (!target) {

            showToast(
                "Enter a peer code"
            );

            peerCodeInput.focus();

            return;
        }


        if (
            target ===
            myPeerId
        ) {

            showToast(
                "You cannot connect to yourself"
            );

            return;
        }


        if (
            !socket ||
            !socket.connected
        ) {

            showToast(
                "Signaling server is not connected"
            );

            return;
        }


        remotePeerId =
            target;

        remotePeerName =
            "AlfaShare User";

        isInitiator = true;

        closePeerConnection();

        setConnectionState(
            "connecting",
            "Connecting to peer..."
        );

        connectBtn.disabled =
            true;

        socket.emit(
            "peer:lookup",
            {
                peerId:
                    remotePeerId
            }
        );

        /*
            Give lookup a moment,
            then start the WebRTC offer.
        */

        setTimeout(() => {

            if (
                remotePeerId &&
                isInitiator &&
                !dataChannel
            ) {

                createOffer();
            }

        }, 350);
    }


    /* =====================================================
       WEBRTC
    ===================================================== */

    function createPeerConnection() {

        closePeerConnection();

        peerConnection =
            new RTCPeerConnection({
                iceServers:
                    ICE_SERVERS,

                bundlePolicy:
                    "max-bundle",

                rtcpMuxPolicy:
                    "require"
            });


        peerConnection.onicecandidate =
            event => {

                if (
                    event.candidate &&
                    remotePeerId &&
                    socket &&
                    socket.connected
                ) {

                    socket.emit(
                        "signal:ice",
                        {
                            to:
                                remotePeerId,

                            from:
                                myPeerId,

                            candidate:
                                event.candidate
                        }
                    );
                }
            };


        peerConnection.onconnectionstatechange =
            () => {

                const state =
                    peerConnection
                        .connectionState;

                console.log(
                    "Peer connection:",
                    state
                );


                if (
                    state ===
                    "connected"
                ) {

                    onPeerConnected();

                } else if (
                    state ===
                    "disconnected"
                ) {

                    setConnectionState(
                        "connecting",
                        "Connection interrupted..."
                    );

                    /*
                        ICE may recover automatically.
                    */

                } else if (
                    state ===
                    "failed"
                ) {

                    showToast(
                        "Connection lost. Trying again..."
                    );

                    attemptIceRestart();

                } else if (
                    state ===
                    "closed"
                ) {

                    onPeerDisconnected();
                }
            };


        peerConnection.ondatachannel =
            event => {

                setupDataChannel(
                    event.channel
                );
            };


        peerConnection.oniceconnectionstatechange =
            () => {

                const state =
                    peerConnection
                        .iceConnectionState;

                console.log(
                    "ICE:",
                    state
                );

                if (
                    state ===
                    "failed"
                ) {

                    attemptIceRestart();
                }
            };

        return peerConnection;
    }


    function setupDataChannel(channel) {

        dataChannel =
            channel;

        dataChannel.binaryType =
            "arraybuffer";

        dataChannel.bufferedAmountLowThreshold =
            BUFFERED_LOW_THRESHOLD;


        dataChannel.onopen =
            () => {

                console.log(
                    "DataChannel opened"
                );

                onPeerConnected();

                sendData({
                    type:
                        "profile",

                    name:
                        myName
                });
            };


        dataChannel.onclose =
            () => {

                console.log(
                    "DataChannel closed"
                );

                dataChannel = null;

                setConnectionState(
                    "connecting",
                    "Peer disconnected"
                );

                updateRemotePresence(
                    false
                );
            };


        dataChannel.onerror =
            error => {

                console.warn(
                    "DataChannel error:",
                    error
                );
            };


        dataChannel.onmessage =
            event => {

                handleDataMessage(
                    event.data
                );
            };
    }


    async function createOffer() {

        if (
            !remotePeerId
        ) {
            return;
        }

        try {

            createPeerConnection();

            isInitiator = true;

            const channel =
                peerConnection.createDataChannel(
                    "alfashare",
                    {
                        ordered: true
                    }
                );

            setupDataChannel(
                channel
            );


            const offer =
                await peerConnection
                    .createOffer({
                        offerToReceiveAudio:
                            false,

                        offerToReceiveVideo:
                            false
                    });


            await peerConnection
                .setLocalDescription(
                    offer
                );


            socket.emit(
                "signal:offer",
                {
                    to:
                        remotePeerId,

                    from:
                        myPeerId,

                    description:
                        peerConnection
                            .localDescription
                }
            );

        } catch (error) {

            console.error(
                "Create offer failed:",
                error
            );

            connectBtn.disabled =
                false;

            showToast(
                "Could not start connection"
            );
        }
    }


    async function handleOffer(data) {

        if (
            !data.from
        ) {
            return;
        }

        remotePeerId =
            data.from;

        isInitiator = false;

        createPeerConnection();

        await peerConnection
            .setRemoteDescription(
                new RTCSessionDescription(
                    data.description
                )
            );

        await addPendingIceCandidates();

        const answer =
            await peerConnection
                .createAnswer();

        await peerConnection
            .setLocalDescription(
                answer
            );

        socket.emit(
            "signal:answer",
            {
                to:
                    remotePeerId,

                from:
                    myPeerId,

                description:
                    peerConnection
                        .localDescription
            }
        );

        setConnectionState(
            "connecting",
            "Accepting connection..."
        );
    }


    async function handleAnswer(data) {

        if (
            !peerConnection
        ) {
            return;
        }

        if (
            !data.description
        ) {
            return;
        }

        await peerConnection
            .setRemoteDescription(
                new RTCSessionDescription(
                    data.description
                )
            );

        await addPendingIceCandidates();
    }


    async function handleIce(data) {

        if (
            !data.candidate
        ) {
            return;
        }


        const candidate =
            new RTCIceCandidate(
                data.candidate
            );


        if (
            peerConnection &&
            peerConnection.remoteDescription
        ) {

            await peerConnection
                .addIceCandidate(
                    candidate
                );

        } else {

            pendingCandidates.push(
                candidate
            );
        }
    }


    async function addPendingIceCandidates() {

        if (
            !peerConnection
        ) {
            return;
        }

        while (
            pendingCandidates.length
        ) {

            const candidate =
                pendingCandidates.shift();

            try {

                await peerConnection
                    .addIceCandidate(
                        candidate
                    );

            } catch (error) {

                console.warn(
                    "Pending ICE error:",
                    error
                );
            }
        }
    }


    async function attemptIceRestart() {

        if (
            !peerConnection ||
            !remotePeerId ||
            !isInitiator ||
            !socket ||
            !socket.connected
        ) {
            return;
        }

        try {

            const offer =
                await peerConnection
                    .createOffer({
                        iceRestart: true
                    });

            await peerConnection
                .setLocalDescription(
                    offer
                );

            socket.emit(
                "signal:offer",
                {
                    to:
                        remotePeerId,

                    from:
                        myPeerId,

                    description:
                        peerConnection
                            .localDescription,

                    restart:
                        true
                }
            );

        } catch (error) {

            console.warn(
                "ICE restart failed:",
                error
            );
        }
    }


    function closePeerConnection() {

        pendingCandidates = [];

        if (dataChannel) {

            try {
                dataChannel.close();
            } catch {}
        }

        dataChannel = null;


        if (peerConnection) {

            try {
                peerConnection.close();
            } catch {}
        }

        peerConnection = null;
    }


    /* =====================================================
       PEER UI
    ===================================================== */

    function onPeerConnected() {

        if (!remotePeerId) {
            return;
        }

        setConnectionState(
            "online",
            "Peer connected"
        );

        connectedPeer.hidden =
            false;

        connectedPeerName.textContent =
            remotePeerName ||
            "AlfaShare User";

        connectedPeerStatus.textContent =
            "Online • Direct P2P";

        connectBtn.disabled =
            false;

        peerCodeInput.value =
            remotePeerId;

        updatePeerUI();

        showToast(
            `Connected to ${remotePeerName || "peer"}`
        );

        clearChatEmptyState();
    }


    function onPeerDisconnected() {

        setConnectionState(
            "offline",
            "Peer offline"
        );

        updateRemotePresence(
            false
        );
    }


    function updatePeerUI() {

        const name =
            remotePeerName ||
            "AlfaShare User";


        if (connectedPeerName) {

            connectedPeerName.textContent =
                name;
        }


        if (chatPeerName) {

            chatPeerName.textContent =
                name;
        }


        if (chatPeerStatus) {

            chatPeerStatus.textContent =
                dataChannel &&
                dataChannel.readyState ===
                "open"

                    ? "Online • Direct P2P"

                    : "Offline";
        }
    }


    function updateRemotePresence(
        online
    ) {

        if (
            !online &&
            dataChannel &&
            dataChannel.readyState ===
            "open"
        ) {

            online = true;
        }


        if (connectedPeerStatus) {

            connectedPeerStatus.textContent =
                online
                    ? "Online • Direct P2P"
                    : "Offline";
        }


        if (chatPeerStatus) {

            chatPeerStatus.textContent =
                online
                    ? "Online"
                    : "Offline";
        }
    }


    function handlePeerOffline() {

        connectBtn.disabled =
            false;

        setConnectionState(
            "offline",
            "Peer offline"
        );

        showToast(
            "That peer is currently offline"
        );
    }


    disconnectBtn.addEventListener(
        "click",
        () => {

            closePeerConnection();

            remotePeerId = null;

            remotePeerName = null;

            connectedPeer.hidden =
                true;

            connectBtn.disabled =
                false;

            peerCodeInput.value =
                "";

            updatePeerUI();

            setConnectionState(
                "online",
                "Server connected"
            );

            showToast(
                "Peer disconnected"
            );
        }
    );


    /* =====================================================
       DATA CHANNEL SEND
    ===================================================== */

    function canSendData() {

        return (
            dataChannel &&
            dataChannel.readyState ===
            "open"
        );
    }


    function sendData(data) {

        if (!canSendData()) {
            return false;
        }

        try {

            dataChannel.send(
                JSON.stringify(data)
            );

            return true;

        } catch (error) {

            console.warn(
                "Data send failed:",
                error
            );

            return false;
        }
    }


    /* =====================================================
       CHAT
    ===================================================== */

    sendMessageBtn.addEventListener(
        "click",
        sendMessage
    );


    messageInput.addEventListener(
        "keydown",
        event => {

            if (
                event.key ===
                "Enter" &&
                !event.shiftKey
            ) {

                event.preventDefault();

                sendMessage();
            }
        }
    );


    function sendMessage() {

        const text =
            messageInput.value
                .trim();

        if (!text) {
            return;
        }


        if (!canSendData()) {

            showToast(
                "Connect to a peer first"
            );

            return;
        }


        const messageId =
            `${Date.now()}-${Math.random()
                .toString(36)
                .slice(2, 8)}`;


        const payload = {

            type:
                "chat",

            id:
                messageId,

            text:
                text,

            time:
                Date.now()
        };


        const sent =
            sendData(payload);


        if (!sent) {

            showToast(
                "Message could not be sent"
            );

            return;
        }


        addMessage(
            text,
            true,
            "✓",
            formatTime()
        );


        messageInput.value =
            "";


        /*
            Delivery acknowledgement
        */

        setTimeout(() => {

            markMessageDelivered(
                messageId
            );

        }, 150);
    }


    function handleChatMessage(data) {

        addMessage(
            data.text,
            false,
            "✓✓",
            new Date(
                data.time || Date.now()
            ).toLocaleTimeString(
                [],
                {
                    hour:
                        "2-digit",

                    minute:
                        "2-digit"
                }
            )
        );


        /*
            Tell sender that message was
            delivered/read.
        */

        sendData({
            type:
                "chat:delivered",

            id:
                data.id
        });
    }


    function markMessageDelivered() {

        const rows =
            messages.querySelectorAll(
                ".message-row.mine"
            );

        const last =
            rows[rows.length - 1];

        if (!last) return;

        const ticks =
            last.querySelector(
                ".message-ticks"
            );

        if (ticks) {

            ticks.textContent =
                "✓✓";
        }
    }


    function handleDelivery(data) {

        if (!data.id) {
            return;
        }

        markMessageDelivered(
            data.id
        );
    }


    function addMessage(
        text,
        mine,
        ticks,
        time
    ) {

        clearChatEmptyState();

        const row =
            document.createElement(
                "div"
            );

        row.className =
            `message-row ${
                mine ? "mine" : ""
            }`;


        const bubble =
            document.createElement(
                "div"
            );

        bubble.className =
            "message";


        const body =
            document.createElement(
                "div"
            );

        body.textContent =
            text;


        const meta =
            document.createElement(
                "div"
            );

        meta.className =
            "message-meta";


        const timeElement =
            document.createElement(
                "span"
            );

        timeElement.textContent =
            time;


        meta.appendChild(
            timeElement
        );


        if (mine) {

            const tick =
                document.createElement(
                    "span"
                );

            tick.className =
                "message-ticks";

            tick.textContent =
                ticks || "✓";

            meta.appendChild(
                tick
            );
        }


        bubble.appendChild(
            body
        );

        bubble.appendChild(
            meta
        );

        row.appendChild(
            bubble
        );

        messages.appendChild(
            row
        );


        messages.scrollTop =
            messages.scrollHeight;
    }


    function clearChatEmptyState() {

        const empty =
            messages.querySelector(
                ".chat-empty"
            );

        if (empty) {

            empty.remove();
        }
    }


    /* =====================================================
       EMOJI
    ===================================================== */

    emojiBtn.addEventListener(
        "click",
        () => {

            emojiPanel.hidden =
                !emojiPanel.hidden;
        }
    );


    $$("#emojiPanel button")
        .forEach(button => {

            button.addEventListener(
                "click",
                () => {

                    const emoji =
                        button.textContent;

                    insertAtCursor(
                        messageInput,
                        emoji
                    );

                    messageInput.focus();
                }
            );
        });


    function insertAtCursor(
        input,
        text
    ) {

        const start =
            input.selectionStart;

        const end =
            input.selectionEnd;

        const value =
            input.value;

        input.value =
            value.slice(0, start) +
            text +
            value.slice(end);

        const cursor =
            start +
            text.length;

        input.setSelectionRange(
            cursor,
            cursor
        );
    }


    /* =====================================================
       FILE PICKER
    ===================================================== */

    chooseFileBtn.addEventListener(
        "click",
        () => {

            if (!canSendData()) {

                showToast(
                    "Connect to a peer first"
                );

                return;
            }

            fileInput.click();
        }
    );


    fileInput.addEventListener(
        "change",
        event => {

            const file =
                event.target.files?.[0];

            if (file) {

                sendFile(file);
            }

            fileInput.value =
                "";
        }
    );


    chatFileBtn.addEventListener(
        "click",
        () => {

            if (!canSendData()) {

                showToast(
                    "Connect to a peer first"
                );

                return;
            }

            fileInput.click();
        }
    );


    /* =====================================================
       DRAG & DROP
    ===================================================== */

    [
        "dragenter",
        "dragover"
    ]
        .forEach(eventName => {

            dropZone.addEventListener(
                eventName,
                event => {

                    event.preventDefault();

                    dropZone.classList.add(
                        "dragging"
                    );
                }
            );
        });


    [
        "dragleave",
        "drop"
    ]
        .forEach(eventName => {

            dropZone.addEventListener(
                eventName,
                event => {

                    event.preventDefault();

                    dropZone.classList.remove(
                        "dragging"
                    );
                }
            );
        });


    dropZone.addEventListener(
        "drop",
        event => {

            if (!canSendData()) {

                showToast(
                    "Connect to a peer first"
                );

                return;
            }

            const files =
                Array.from(
                    event.dataTransfer.files
                );

            if (files.length) {

                sendFile(
                    files[0]
                );
            }
        }
    );


    /* =====================================================
       OUTGOING FILE TRANSFER
    ===================================================== */

    async function sendFile(file) {

        if (!canSendData()) {

            showToast(
                "Peer is not connected"
            );

            return;
        }


        const transferId =
            `${Date.now()}-${++transferCounter}`;


        const item =
            createTransferUI(
                transferId,
                file.name,
                file.size,
                "upload"
            );


        outgoingTransfers.set(
            transferId,
            {
                file,
                item,
                offset: 0,
                startedAt: Date.now()
            }
        );


        const metadata = {

            type:
                "file:start",

            id:
                transferId,

            name:
                file.name,

            size:
                file.size,

            mime:
                file.type ||
                "application/octet-stream"
        };


        if (!sendData(metadata)) {

            showToast(
                "Could not start file transfer"
            );

            outgoingTransfers.delete(
                transferId
            );

            return;
        }


        showToast(
            `Sending ${file.name}`
        );


        await streamFile(
            transferId
        );
    }


    async function streamFile(
        transferId
    ) {

        const transfer =
            outgoingTransfers.get(
                transferId
            );

        if (!transfer) {
            return;
        }


        const {
            file,
            item
        } = transfer;


        let offset = 0;

        const startedAt =
            Date.now();


        try {

            while (
                offset <
                file.size
            ) {

                if (!canSendData()) {

                    throw new Error(
                        "Peer connection lost"
                    );
                }


                /*
                    Backpressure.

                    We wait when the browser's
                    outgoing DataChannel buffer
                    becomes large.

                    This prevents RAM explosion
                    and keeps large files stable.
                */

                await waitForBuffer();


                const end =
                    Math.min(
                        offset +
                        CHUNK_SIZE,

                        file.size
                    );


                const blob =
                    file.slice(
                        offset,
                        end
                    );


                const buffer =
                    await blob.arrayBuffer();


                dataChannel.send(
                    buffer
                );


                offset =
                    end;


                transfer.offset =
                    offset;


                updateTransferProgress(
                    item,
                    offset,
                    file.size,
                    startedAt
                );


                /*
                    Give the browser a chance
                    to process UI/events.
                */

                if (
                    dataChannel.bufferedAmount >
                    BUFFERED_LOW_THRESHOLD
                ) {

                    await waitForBuffer();
                }
            }


            sendData({
                type:
                    "file:end",

                id:
                    transferId
            });


            updateTransferProgress(
                item,
                file.size,
                file.size,
                startedAt,
                true
            );


            saveTransferHistory(
                {
                    direction:
                        "sent",

                    name:
                        file.name,

                    size:
                        file.size,

                    time:
                        Date.now()
                }
            );


            showToast(
                "File sent successfully"
            );


        } catch (error) {

            console.error(
                "File send failed:",
                error
            );


            updateTransferError(
                item,
                error.message
            );


            showToast(
                "File transfer interrupted"
            );
        }


        outgoingTransfers.delete(
            transferId
        );
    }


    function waitForBuffer() {

        return new Promise(
            resolve => {

                if (
                    !dataChannel ||
                    dataChannel.bufferedAmount <=
                    MAX_BUFFERED_AMOUNT
                ) {

                    resolve();

                    return;
                }


                const handler =
                    () => {

                        dataChannel.removeEventListener(
                            "bufferedamountlow",
                            handler
                        );

                        resolve();
                    };


                dataChannel.addEventListener(
                    "bufferedamountlow",
                    handler
                );


                /*
                    Safety fallback.
                */

                setTimeout(() => {

                    dataChannel?.removeEventListener(
                        "bufferedamountlow",
                        handler
                    );

                    resolve();

                }, 1000);
            }
        );
    }


    /* =====================================================
       INCOMING FILE
    ===================================================== */

    function handleFileStart(data) {

        const transfer = {

            id:
                data.id,

            name:
                data.name ||
                "received-file",

            size:
                Number(data.size) || 0,

            mime:
                data.mime ||
                "application/octet-stream",

            chunks: [],

            received:
                0,

            startedAt:
                Date.now(),

            item:
                null
        };


        transfer.item =
            createTransferUI(
                transfer.id,
                transfer.name,
                transfer.size,
                "download"
            );


        incomingTransfers.set(
            transfer.id,
            transfer
        );


        showToast(
            `Receiving ${transfer.name}`
        );
    }


    function handleFileChunk(
        buffer
    ) {

        /*
            DataChannel can deliver binary
            data as ArrayBuffer or Blob.
        */

        if (
            buffer instanceof Blob
        ) {

            buffer.arrayBuffer()
                .then(
                    handleBinaryBuffer
                );

        } else {

            handleBinaryBuffer(
                buffer
            );
        }
    }


    function handleBinaryBuffer(
        buffer
    ) {

        if (
            !(buffer instanceof ArrayBuffer)
        ) {
            return;
        }


        /*
            There should normally be
            exactly one active incoming file.

            For this core version we map
            binary chunks to the newest
            incoming transfer.
        */

        const transfers =
            Array.from(
                incomingTransfers.values()
            );


        if (!transfers.length) {
            return;
        }


        const transfer =
            transfers[
                transfers.length - 1
            ];


        transfer.chunks.push(
            buffer
        );


        transfer.received +=
            buffer.byteLength;


        updateTransferProgress(
            transfer.item,
            transfer.received,
            transfer.size,
            transfer.startedAt
        );
    }


    async function handleFileEnd(
        data
    ) {

        const transfer =
            incomingTransfers.get(
                data.id
            );


        if (!transfer) {
            return;
        }


        try {

            const blob =
                new Blob(
                    transfer.chunks,
                    {
                        type:
                            transfer.mime
                    }
                );


            const url =
                URL.createObjectURL(
                    blob
                );


            const anchor =
                document.createElement(
                    "a"
                );


            anchor.href =
                url;

            anchor.download =
                transfer.name;

            anchor.style.display =
                "none";


            document.body.appendChild(
                anchor
            );


            anchor.click();


            anchor.remove();


            setTimeout(() => {

                URL.revokeObjectURL(
                    url
                );

            }, 10000);


            updateTransferProgress(
                transfer.item,
                transfer.size,
                transfer.size,
                transfer.startedAt,
                true
            );


            saveTransferHistory(
                {
                    direction:
                        "received",

                    name:
                        transfer.name,

                    size:
                        transfer.size,

                    time:
                        Date.now()
                }
            );


            showToast(
                `${transfer.name} received`
            );


        } catch (error) {

            console.error(
                "File assembly error:",
                error
            );


            updateTransferError(
                transfer.item,
                "Could not assemble file"
            );
        }


        incomingTransfers.delete(
            data.id
        );
    }


    /* =====================================================
       DATA MESSAGE ROUTER
    ===================================================== */

    function handleDataMessage(
        raw
    ) {

        if (
            typeof raw ===
            "string"
        ) {

            const data =
                safeJSONParse(
                    raw
                );


            if (!data) {
                return;
            }


            switch (
                data.type
            ) {

                case "profile":

                    remotePeerName =
                        data.name ||
                        "AlfaShare User";

                    updatePeerUI();

                    break;


                case "chat":

                    handleChatMessage(
                        data
                    );

                    break;


                case "chat:delivered":

                    handleDelivery(
                        data
                    );

                    break;


                case "file:start":

                    handleFileStart(
                        data
                    );

                    break;


                case "file:end":

                    handleFileEnd(
                        data
                    );

                    break;


                default:

                    console.warn(
                        "Unknown message:",
                        data.type
                    );
            }

            return;
        }


        /*
            Binary chunk
        */

        handleFileChunk(
            raw
        );
    }


    /* =====================================================
       TRANSFER UI
    ===================================================== */

    function createTransferUI(
        id,
        name,
        size,
        direction
    ) {

        const empty =
            transferList.querySelector(
                ".empty-state"
            );

        if (empty) {
            empty.remove();
        }


        const item =
            document.createElement(
                "div"
            );

        item.className =
            "transfer-item";

        item.dataset.id =
            id;


        item.innerHTML = `
            <div class="transfer-top">

                <div class="file-icon">
                    ${direction === "upload" ? "↑" : "↓"}
                </div>

                <div class="file-info">

                    <strong></strong>

                    <span>
                        ${formatBytes(size)}
                    </span>

                </div>

                <div class="transfer-percent">
                    0%
                </div>

            </div>

            <div class="progress-track">

                <div class="progress-bar"></div>

            </div>
        `;


        const nameElement =
            item.querySelector(
                ".file-info strong"
            );


        nameElement.textContent =
            name;


        transferList.prepend(
            item
        );


        return item;
    }


    function updateTransferProgress(
        item,
        current,
        total,
        startedAt,
        complete = false
    ) {

        if (!item) {
            return;
        }


        const percent =
            total > 0
                ? Math.min(
                    100,
                    Math.round(
                        current /
                        total *
                        100
                    )
                )
                : 0;


        const progress =
            item.querySelector(
                ".progress-bar"
            );


        const percentage =
            item.querySelector(
                ".transfer-percent"
            );


        if (progress) {

            progress.style.width =
                `${percent}%`;
        }


        if (percentage) {

            percentage.textContent =
                `${percent}%`;
        }


        if (complete) {

            item.classList.add(
                "complete"
            );

            if (percentage) {

                percentage.textContent =
                    "✓";
            }
        }
    }


    function updateTransferError(
        item,
        message
    ) {

        if (!item) {
            return;
        }


        const percentage =
            item.querySelector(
                ".transfer-percent"
            );


        if (percentage) {

            percentage.textContent =
                "!";
        }


        const info =
            item.querySelector(
                ".file-info span"
            );


        if (info) {

            info.textContent =
                message ||
                "Transfer failed";
        }
    }


    clearTransfersBtn.addEventListener(
        "click",
        () => {

            transferList.innerHTML = `
                <div class="empty-state">

                    <div>↑</div>

                    <p>
                        No active transfers
                    </p>

                </div>
            `;
        }
    );


    /* =====================================================
       HISTORY
    ===================================================== */

    function saveTransferHistory(
        record
    ) {

        const history =
            safeJSONParse(
                loadStorage(
                    STORAGE_KEYS.history,
                    "[]"
                ),
                []
            );


        history.unshift(
            record
        );


        /*
            Keep only recent local history.
        */

        history.splice(
            100
        );


        saveStorage(
            STORAGE_KEYS.history,
            JSON.stringify(history)
        );
    }


    /* =====================================================
       COPY PEER CODE
    ===================================================== */

    copyPeerCodeBtn.addEventListener(
        "click",
        async () => {

            try {

                await navigator.clipboard
                    .writeText(
                        myPeerId
                    );

                showToast(
                    "Peer code copied"
                );

            } catch {

                showToast(
                    "Copy failed"
                );
            }
        }
    );


    /* =====================================================
       PWA
    ===================================================== */

    function registerServiceWorker() {

        if (
            "serviceWorker" in
            navigator
        ) {

            window.addEventListener(
                "load",
                () => {

                    navigator.serviceWorker
                        .register(
                            "/sw.js"
                        )
                        .then(
                            registration => {

                                console.log(
                                    "PWA service worker registered:",
                                    registration.scope
                                );
                            }
                        )
                        .catch(
                            error => {

                                console.warn(
                                    "Service worker:",
                                    error
                                );
                            }
                        );
                }
            );
        }
    }


    /* =====================================================
       PAGE VISIBILITY
    ===================================================== */

    document.addEventListener(
        "visibilitychange",
        () => {

            if (
                document.visibilityState ===
                "visible"
            ) {

                /*
                    If signaling dropped while
                    the page was hidden, reconnect.
                */

                if (
                    socket &&
                    !socket.connected
                ) {

                    socket.connect();
                }
            }
        }
    );


    /* =====================================================
       NETWORK STATUS
    ===================================================== */

    window.addEventListener(
        "online",
        () => {

            if (
                socket &&
                !socket.connected
            ) {

                socket.connect();
            }

            showToast(
                "Internet connection restored"
            );
        }
    );


    window.addEventListener(
        "offline",
        () => {

            setConnectionState(
                "offline",
                "Internet unavailable"
            );

            showToast(
                "Internet connection lost"
            );
        }
    );


    /* =====================================================
       INITIALIZE
    ===================================================== */

    function initialize() {

        initializeProfile();

        initializeTheme();

        registerServiceWorker();

        connectSocket();

        console.log(
            "AlfaShare initialized",
            {
                peerId:
                    myPeerId
            }
        );
    }


    initialize();

})();
