// Complete QuikChat Frontend Script
const socket = io();
let pc = null;
let localStream = null;
let remoteStream = null;
let currentRoom = null;
let currentPartner = null;
let callTimer = null;
let callStartTime = null;
let coins = 100;
let isPremium = false;
let userData = null;

// DOM Elements
const startScreen = document.getElementById('startScreen');
const chatScreen = document.getElementById('chatScreen');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const remoteOverlay = document.getElementById('remoteOverlay');
const partnerName = document.getElementById('partnerName');
const partnerGender = document.getElementById('partnerGender');
const partnerCountry = document.getElementById('partnerCountry');
const callStatus = document.getElementById('callStatus');
const coinCount = document.getElementById('coinCount');
const userId = document.getElementById('userId');
const onlineCount = document.getElementById('onlineCount');
const onlineList = document.getElementById('onlineList');
const chatMessages = document.getElementById('chatMessages');
const messageInput = document.getElementById('messageInput');
const callTimerDisplay = document.getElementById('callTimer');
const totalChatsDisplay = document.getElementById('totalChats');
const userRating = document.getElementById('userRating');
const displayName = document.getElementById('displayName');
const connectionStatus = document.getElementById('connectionStatus');

// Control Buttons
const findBtn = document.getElementById('findBtn');
const nextBtn = document.getElementById('nextBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const reportBtn = document.getElementById('reportBtn');
const muteBtn = document.getElementById('muteBtn');
const videoBtn = document.getElementById('videoBtn');
const switchCamBtn = document.getElementById('switchCamBtn');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    updateCoinDisplay();
    initEventListeners();
    checkCameraPermission();
});

// Event Listeners
function initEventListeners() {
    // Control buttons
    if (muteBtn) muteBtn.addEventListener('click', toggleMute);
    if (videoBtn) videoBtn.addEventListener('click', toggleVideo);
    if (switchCamBtn) switchCamBtn.addEventListener('click', switchCamera);
    
    // Socket events
    socket.on('connect', handleSocketConnect);
    socket.on('registered', handleRegistered);
    socket.on('queue-update', handleQueueUpdate);
    socket.on('matched', handleMatched);
    socket.on('partner-disconnected', handlePartnerDisconnected);
    socket.on('signal', handleSignal);
    socket.on('chat-message', handleChatMessage);
    socket.on('online-users', handleOnlineUsers);
    socket.on('private-invite-received', handlePrivateInvite);
    socket.on('private-room-started', handlePrivateRoomStarted);
    socket.on('coins-updated', handleCoinsUpdated);
    socket.on('ad-required', handleAdRequired);
    socket.on('nudity-warning', handleNudityWarning);
    socket.on('error', handleError);
}

// Socket Handlers
function handleSocketConnect() {
    console.log('Connected to server:', socket.id);
    userId.textContent = socket.id.substring(0, 8) + '...';
    connectionStatus.textContent = 'Online';
    connectionStatus.className = 'user-status online';
}

function handleRegistered(data) {
    userData = data;
    coins = data.coins;
    isPremium = data.isPremium;
    updateCoinDisplay();
    showToast('Connected to server!', 'success');
}

function handleQueueUpdate(data) {
    showToast(`In queue: Position ${data.position}`, 'info');
}

function handleMatched(data) {
    currentPartner = data.partner;
    currentRoom = data.roomId;
    
    // Update UI
    partnerName.textContent = data.partnerInfo.name;
    partnerGender.textContent = data.partnerInfo.gender;
    partnerCountry.textContent = getCountryFlag(data.partnerInfo.country);
    remoteOverlay.style.display = 'flex';
    
    // Enable/disable buttons
    findBtn.disabled = true;
    nextBtn.disabled = false;
    disconnectBtn.disabled = false;
    reportBtn.disabled = false;
    
    // Start WebRTC
    startWebRTC();
    
    showToast(`Matched with ${data.partnerInfo.name}!`, 'success');
    addChatMessage('system', 'You are now connected with ' + data.partnerInfo.name);
    
    // Start call timer
    startCallTimer();
}

function handlePartnerDisconnected() {
    showToast('Partner disconnected', 'warning');
    endCall();
    addChatMessage('system', 'Partner disconnected');
}

function handleSignal(data) {
    if (!pc) return;
    
    switch (data.signal.type) {
        case 'offer':
            handleOffer(data.signal);
            break;
        case 'answer':
            handleAnswer(data.signal);
            break;
        case 'candidate':
            handleCandidate(data.signal);
            break;
    }
}

function handleChatMessage(data) {
    addChatMessage('partner', data.message, data.fromName);
}

function handleOnlineUsers(users) {
    onlineCount.textContent = users.length;
    updateOnlineList(users);
}

function handlePrivateInvite(data) {
    if (confirm(`${data.fromName} invited you to a private chat. Accept?`)) {
        socket.emit('private-accept', { roomId: data.roomId });
    } else {
        socket.emit('private-decline', { from: data.from });
    }
}

function handlePrivateRoomStarted(data) {
    currentRoom = data.roomId;
    currentPartner = data.partnerId;
    
    remoteOverlay.style.display = 'none';
    findBtn.disabled = true;
    nextBtn.disabled = true;
    disconnectBtn.disabled = false;
    
    showToast('Private chat started!', 'success');
    addChatMessage('system', 'Private chat started');
    
    startCallTimer();
}

function handleCoinsUpdated(data) {
    coins = data.coins;
    updateCoinDisplay();
    showToast(`Coins updated: ${coins}`, 'info');
}

function handleAdRequired(data) {
    showAdModal();
}

function handleNudityWarning(data) {
    if (data.suggestPrivate) {
        if (confirm('Content not allowed in public chat. Switch to private room?')) {
            showPrivateModal();
        }
    }
    showToast('Warning: Content not allowed', 'warning');
}

function handleError(data) {
    showToast(data.message, 'error');
}

// WebRTC Functions
async function startWebRTC() {
    try {
        if (!localStream) {
            await startLocalStream();
        }
        
        pc = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        });
        
        // Add local stream
        localStream.getTracks().forEach(track => {
            pc.addTrack(track, localStream);
        });
        
        // Remote stream handler
        pc.ontrack = (event) => {
            if (!remoteStream) {
                remoteStream = new MediaStream();
                remoteVideo.srcObject = remoteStream;
            }
            remoteStream.addTrack(event.track);
            remoteOverlay.style.display = 'none';
        };
        
        // ICE candidate handler
        pc.onicecandidate = (event) => {
            if (event.candidate && currentPartner) {
                socket.emit('signal', {
                    to: currentPartner,
                    roomId: currentRoom,
                    signal: {
                        type: 'candidate',
                        candidate: event.candidate
                    }
                });
            }
        };
        
        // Connection state
        pc.onconnectionstatechange = () => {
            console.log('Connection state:', pc.connectionState);
            if (pc.connectionState === 'disconnected' || 
                pc.connectionState === 'failed' ||
                pc.connectionState === 'closed') {
                endCall();
            }
        };
        
        // Create offer if we initiated
        if (socket.id < currentPartner) {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            
            socket.emit('signal', {
                to: currentPartner,
                roomId: currentRoom,
                signal: {
                    type: 'offer',
                    sdp: offer.sdp
                }
            });
        }
        
    } catch (error) {
        console.error('WebRTC error:', error);
        showToast('Connection error', 'error');
    }
}

async function handleOffer(offer) {
    try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        
        socket.emit('signal', {
            to: currentPartner,
            roomId: currentRoom,
            signal: {
                type: 'answer',
                sdp: answer.sdp
            }
        });
    } catch (error) {
        console.error('Handle offer error:', error);
    }
}

async function handleAnswer(answer) {
    try {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
    } catch (error) {
        console.error('Handle answer error:', error);
    }
}

async function handleCandidate(candidate) {
    try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
        console.error('Handle candidate error:', error);
    }
}

// Media Functions
async function startLocalStream() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                facingMode: 'user'
            },
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });
        
        localVideo.srcObject = localStream;
        return localStream;
    } catch (error) {
        console.error('Camera error:', error);
        showToast('Camera/mic permission required!', 'error');
        return null;
    }
}

async function checkCameraPermission() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const hasCamera = devices.some(device => device.kind === 'videoinput');
        const hasMic = devices.some(device => device.kind === 'audioinput');
        
        if (!hasCamera || !hasMic) {
            showToast('Camera/mic not detected', 'warning');
        }
    } catch (error) {
        console.error('Device check error:', error);
    }
}

function toggleMute() {
    if (!localStream) return;
    
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        muteBtn.innerHTML = audioTrack.enabled ? 
            '<i class="fas fa-microphone"></i>' : 
            '<i class="fas fa-microphone-slash"></i>';
        muteBtn.title = audioTrack.enabled ? 'Mute' : 'Unmute';
        
        showToast(audioTrack.enabled ? 'Microphone on' : 'Microphone off', 'info');
    }
}

function toggleVideo() {
    if (!localStream) return;
    
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        videoBtn.innerHTML = videoTrack.enabled ? 
            '<i class="fas fa-video"></i>' : 
            '<i class="fas fa-video-slash"></i>';
        videoBtn.title = videoTrack.enabled ? 'Turn off camera' : 'Turn on camera';
        
        showToast(videoTrack.enabled ? 'Camera on' : 'Camera off', 'info');
    }
}

async function switchCamera() {
    if (!localStream) return;
    
    try {
        const currentTrack = localStream.getVideoTracks()[0];
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(d => d.kind === 'videoinput');
        
        if (videoDevices.length < 2) {
            showToast('Only one camera found', 'warning');
            return;
        }
        
        const currentDeviceId = currentTrack.getSettings().deviceId;
        const otherDevice = videoDevices.find(d => d.deviceId !== currentDeviceId);
        
        if (!otherDevice) return;
        
        const newStream = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: otherDevice.deviceId } },
            audio: true
        });
        
        const newVideoTrack = newStream.getVideoTracks()[0];
        
        // Replace track in local stream
        localStream.removeTrack(currentTrack);
        localStream.addTrack(newVideoTrack);
        currentTrack.stop();
        
        // Replace track in peer connection
        if (pc) {
            const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
            if (sender) sender.replaceTrack(newVideoTrack);
        }
        
        // Stop audio track from new stream
        newStream.getAudioTracks().forEach(track => track.stop());
        
        showToast('Camera switched', 'success');
    } catch (error) {
        console.error('Switch camera error:', error);
        showToast('Failed to switch camera', 'error');
    }
}

// Chat Functions
function sendMessage() {
    const message = messageInput.value.trim();
    if (!message || !currentRoom) return;
    
    // Add to chat
    addChatMessage('self', message);
    
    // Send to server
    socket.emit('chat-message', {
        roomId: currentRoom,
        message: message,
        type: 'text'
    });
    
    // Clear input
    messageInput.value = '';
}

function addChatMessage(type, message, sender = 'You') {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;
    
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    
    if (type !== 'system') {
        const senderSpan = document.createElement('div');
        senderSpan.className = 'message-sender';
        senderSpan.textContent = sender;
        bubble.appendChild(senderSpan);
    }
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    
    // Check if message is an image/data URL
    if (message.startsWith('data:image')) {
        const img = document.createElement('img');
        img.src = message;
        img.style.maxWidth = '200px';
        contentDiv.appendChild(img);
    } else if (message.startsWith('data:')) {
        const link = document.createElement('a');
        link.href = message;
        link.textContent = 'Download file';
        link.target = '_blank';
        link.style.color = '#667eea';
        contentDiv.appendChild(link);
    } else {
        contentDiv.textContent = message;
    }
    
    bubble.appendChild(contentDiv);
    messageDiv.appendChild(bubble);
    chatMessages.appendChild(messageDiv);
    
    // Scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function clearChat() {
    if (confirm('Clear all chat messages?')) {
        chatMessages.innerHTML = '<div class="system-message"><p>Chat cleared</p></div>';
    }
}

function toggleChat() {
    const chatPanel = document.querySelector('.chat-panel');
    const messages = document.querySelector('.chat-messages');
    const input = document.querySelector('.chat-input');
    
    if (messages.style.display === 'none') {
        messages.style.display = 'flex';
        input.style.display = 'flex';
        chatPanel.style.flex = '2';
    } else {
        messages.style.display = 'none';
        input.style.display = 'none';
        chatPanel.style.flex = '0';
    }
}

// User Actions
function startChatting() {
    const name = document.getElementById('nameInput').value.trim();
    const gender = document.getElementById('genderSelect').value;
    const age = parseInt(document.getElementById('ageInput').value);
    const country = document.getElementById('countrySelect').value;
    
    if (!name || !gender || !age || !country) {
        showToast('Please fill all fields', 'error');
        return;
    }
    
    if (age < 18 || age > 100) {
        showToast('Age must be between 18-100', 'error');
        return;
    }
    
    // Get preferences
    const preferences = {
        gender: document.getElementById('prefGender').value,
        country: document.getElementById('prefCountry').value,
        minAge: parseInt(document.getElementById('minAge').value),
        maxAge: parseInt(document.getElementById('maxAge').value)
    };
    
    // Register with server
    socket.emit('register', {
        name: name,
        gender: gender,
        age: age,
        country: country,
        coins: coins,
        isPremium: isPremium,
        preferences: preferences
    });
    
    // Switch to chat screen
    startScreen.classList.remove('active');
    chatScreen.classList.add('active');
    displayName.textContent = name;
    
    // Start local stream
    startLocalStream();
}

function findPartner() {
    if (!userData) {
        showToast('Please complete registration first', 'error');
        return;
    }
    
    // Get current preferences
    const preferences = {
        gender: document.getElementById('prefGender').value,
        country: document.getElementById('prefCountry').value,
        minAge: parseInt(document.getElementById('minAge').value),
        maxAge: parseInt(document.getElementById('maxAge').value)
    };
    
    socket.emit('join-queue', preferences);
    findBtn.disabled = true;
    nextBtn.disabled = true;
    disconnectBtn.disabled = true;
    
    showToast('Searching for partner...', 'info');
}

function nextPartner() {
    if (!currentPartner) return;
    
    socket.emit('next-partner');
    endCall();
    findPartner();
}

function disconnectCall() {
    endCall();
    socket.emit('leave-queue');
    
    findBtn.disabled = false;
    nextBtn.disabled = true;
    disconnectBtn.disabled = true;
    reportBtn.disabled = true;
    
    showToast('Disconnected', 'info');
}

function endCall() {
    // Stop call timer
    stopCallTimer();
    
    // Close peer connection
    if (pc) {
        pc.close();
        pc = null;
    }
    
    // Stop remote stream
    if (remoteStream) {
        remoteStream.getTracks().forEach(track => track.stop());
        remoteStream = null;
        remoteVideo.srcObject = null;
    }
    
    // Reset UI
    currentPartner = null;
    currentRoom = null;
    
    partnerName.textContent = 'Waiting for partner...';
    partnerGender.textContent = 'Unknown';
    partnerCountry.textContent = '🌐';
    remoteOverlay.style.display = 'flex';
}

function reportUser() {
    if (!currentPartner) return;
    
    const reason = prompt('Why are you reporting this user?', 'Inappropriate behavior');
    if (reason) {
        socket.emit('report-user', {
            reportedId: currentPartner,
            reason: reason
        });
        showToast('User reported', 'success');
        nextPartner();
    }
}

// Private Chat
function showPrivateModal() {
    document.getElementById('privateModal').classList.add('active');
}

function startPrivateRoom(isPaid) {
    if (isPaid && coins < 10) {
        showToast('Not enough coins for paid private', 'error');
        showAdModal();
        return;
    }
    
    const targetId = prompt('Enter friend\'s ID:');
    if (targetId) {
        socket.emit('private-invite', {
            targetId: targetId,
            isPaid: isPaid
        });
        showToast('Private invite sent!', 'success');
    }
    
    closeModal('privateModal');
}

function inviteById() {
    const inviteId = document.getElementById('inviteIdInput').value.trim();
    const isPaid = document.getElementById('paidPrivate').checked;
    
    if (!inviteId) {
        showToast('Please enter an ID', 'error');
        return;
    }
    
    socket.emit('private-invite', {
        targetId: inviteId,
        isPaid: isPaid
    });
    
    showToast('Invite sent!', 'success');
    document.getElementById('inviteIdInput').value = '';
}

function sendPrivateInvite() {
    const privateId = document.getElementById('privateIdInput').value.trim();
    const isPaid = document.getElementById('paidPrivate').checked;
    
    if (!privateId) {
        showToast('Please enter a user ID', 'error');
        return;
    }
    
    socket.emit('private-invite', {
        targetId: privateId,
        isPaid: isPaid
    });
    
    showToast('Private invite sent!', 'success');
    document.getElementById('privateIdInput').value = '';
}

// Coin System
function updateCoinDisplay() {
    coinCount.textContent = coins;
}

function showAdModal() {
    document.getElementById('adModal').classList.add('active');
}

function completeAd() {
    // Simulate ad completion
    setTimeout(() => {
        socket.emit('ad-watched');
        showToast('+5 coins earned!', 'success');
        closeModal('adModal');
    }, 5000); // 5 seconds for ad
    
    showToast('Watching ad...', 'info');
}

function showPremiumModal() {
    document.getElementById('premiumModal').classList.add('active');
}

// File Sharing
function openImagePicker() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                // Send image
                socket.emit('share-file', {
                    roomId: currentRoom,
                    fileName: file.name,
                    fileType: file.type,
                    dataUrl: event.target.result
                });
                
                // Add to chat
                addChatMessage('self', event.target.result);
            };
            reader.readAsDataURL(file);
        }
    };
    input.click();
}

function openFilePicker() {
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                // Send file
                socket.emit('share-file', {
                    roomId: currentRoom,
                    fileName: file.name,
                    fileType: file.type,
                    dataUrl: event.target.result
                });
                
                // Add to chat
                const message = `File: ${file.name} (${formatFileSize(file.size)})`;
                addChatMessage('self', message);
            };
            reader.readAsDataURL(file);
        }
    };
    input.click();
}

// Utility Functions
function showToast(message, type = 'info') {
    toastr[type](message);
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

function copyUserId() {
    navigator.clipboard.writeText(socket.id)
        .then(() => showToast('ID copied to clipboard!', 'success'))
        .catch(() => showToast('Failed to copy ID', 'error'));
}

function getCountryFlag(countryCode) {
    const flags = {
        'IN': '🇮🇳',
        'US': '🇺🇸',
        'UK': '🇬🇧',
        'CA': '🇨🇦',
        'AU': '🇦🇺',
        'DE': '🇩🇪',
        'FR': '🇫🇷',
        'JP': '🇯🇵'
    };
    return flags[countryCode] || '🌐';
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function updateOnlineList(users) {
    onlineList.innerHTML = '';
    
    if (users.length === 0) {
        onlineList.innerHTML = '<div class="empty-list">No users online</div>';
        return;
    }
    
    users.forEach(user => {
        if (user.id === socket.id) return; // Don't show self
        
        const userDiv = document.createElement('div');
        userDiv.className = 'online-user';
        userDiv.onclick = () => {
            document.getElementById('privateIdInput').value = user.id;
        };
        
        userDiv.innerHTML = `
            <div class="online-user-avatar">
                <i class="fas fa-user"></i>
            </div>
            <div class="online-user-info">
                <div class="online-user-name">${user.name}</div>
                <div class="online-user-details">
                    ${user.gender} • ${user.country}
                </div>
            </div>
        `;
        
        onlineList.appendChild(userDiv);
    });
}

function startCallTimer() {
    callStartTime = new Date();
    stopCallTimer();
    
    callTimer = setInterval(() => {
        const now = new Date();
        const diff = Math.floor((now - callStartTime) / 1000);
        const minutes = Math.floor(diff / 60);
        const seconds = diff % 60;
        
        callTimerDisplay.textContent = 
            `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }, 1000);
}

function stopCallTimer() {
    if (callTimer) {
        clearInterval(callTimer);
        callTimer = null;
        callTimerDisplay.textContent = '00:00';
    }
}

// Global functions for HTML onclick
window.startChatting = startChatting;
window.findPartner = findPartner;
window.nextPartner = nextPartner;
window.disconnectCall = disconnectCall;
window.reportUser = reportUser;
window.showPrivateModal = showPrivateModal;
window.showAdModal = showAdModal;
window.showPremiumModal = showPremiumModal;
window.sendPrivateInvite = sendPrivateInvite;
window.inviteById = inviteById;
window.sendMessage = sendMessage;
window.clearChat = clearChat;
window.toggleChat = toggleChat;
window.copyUserId = copyUserId;
window.closeModal = closeModal;
window.completeAd = completeAd;
window.startPrivateRoom = startPrivateRoom;

// Handle Enter key in chat
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendMessage();
    }
});

// Handle chat keypress
function handleChatKeyPress(e) {
    if (e.key === 'Enter') {
        sendMessage();
    }
}

// Export for global access
window.QuikChat = {
    socket,
    startChatting,
    findPartner,
    disconnectCall,
    sendMessage,
    showPrivateModal
};
