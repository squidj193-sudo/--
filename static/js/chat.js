let currentSessionId = null;
let currentAbortController = null; // 用於「中止回應」
let pendingImageFile = null; // 待上傳的圖片

// DOM Elements
const sessionListEl = document.getElementById('session-list');
const chatBoxEl = document.getElementById('chat-box');
const chatMessagesEl = document.getElementById('chat-messages');
const chatInputEl = document.getElementById('chat-input');
const btnSendEl = document.getElementById('btn-send');
const btnNewChatEl = document.getElementById('btn-new-chat');

// Upload DOM
const fileInputEl = document.getElementById('file-input');
const btnUploadEl = document.getElementById('btn-upload');
const imagePreviewAreaEl = document.getElementById('image-preview-area');
const imagePreviewEl = document.getElementById('image-preview');
const btnRemoveImageEl = document.getElementById('btn-remove-image');

// Memory DOM
const btnMemoryEl = document.getElementById('btn-memory');
const memoryModalEl = document.getElementById('memory-modal');
const memoryTextEl = document.getElementById('memory-text');
const btnSaveMemoryEl = document.getElementById('btn-save-memory');
const btnCloseMemoryEl = document.getElementById('btn-close-memory');

/* --- 圖片上傳 (Upload) --- */
btnUploadEl.addEventListener('click', () => {
    fileInputEl.click();
});

fileInputEl.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    pendingImageFile = file;
    
    // 顯示圖片預覽
    if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (ev) => {
            imagePreviewEl.src = ev.target.result;
            imagePreviewAreaEl.classList.remove('hidden');
        };
        reader.readAsDataURL(file);
    } else {
        // 非圖片檔案，用文字預覽
        imagePreviewEl.src = '';
        imagePreviewEl.alt = `📄 ${file.name}`;
        imagePreviewAreaEl.classList.remove('hidden');
    }
});

btnRemoveImageEl.addEventListener('click', () => {
    pendingImageFile = null;
    fileInputEl.value = '';
    imagePreviewAreaEl.classList.add('hidden');
    imagePreviewEl.src = '';
});

/* --- 記憶機制 (Memory) --- */
btnMemoryEl.addEventListener('click', async () => {
    try {
        const res = await fetch('/api/memory');
        const data = await res.json();
        memoryTextEl.value = data.content || '';
        memoryModalEl.classList.remove('hidden');
    } catch (e) { console.error(e); }
});

btnSaveMemoryEl.addEventListener('click', async () => {
    try {
        await fetch('/api/memory', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: memoryTextEl.value })
        });
        memoryModalEl.classList.add('hidden');
        alert('記憶已儲存！AI 現在會記住這些偏好了。');
    } catch (e) { console.error(e); }
});

btnCloseMemoryEl.addEventListener('click', () => {
    memoryModalEl.classList.add('hidden');
});

/* --- 對話狀態與歷史管理 --- */
async function loadSessions() {
    try {
        const res = await fetch('/api/chat/sessions');
        const sessions = await res.json();
        sessionListEl.innerHTML = '';
        
        sessions.forEach(session => {
            const date = new Date(session.created_at).toLocaleString('zh-TW', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' });
            
            const div = document.createElement('div');
            div.className = 'session-item';
            if (session.id === currentSessionId) div.classList.add('active');
            
            const titleSpan = document.createElement('span');
            titleSpan.textContent = `占卜紀錄 (${date})`;
            titleSpan.onclick = () => selectSession(session.id);
            
            const delBtn = document.createElement('button');
            delBtn.textContent = '🗑️';
            delBtn.className = 'btn-delete-session';
            delBtn.onclick = (e) => {
                e.stopPropagation();
                deleteSession(session.id);
            };
            
            div.appendChild(titleSpan);
            div.appendChild(delBtn);
            sessionListEl.appendChild(div);
        });
    } catch (e) { console.error(e); }
}

async function deleteSession(sessionId) {
    if (!confirm('確定要刪除這筆紀錄嗎？')) return;
    try {
        await fetch(`/api/chat/sessions/${sessionId}`, { method: 'DELETE' });
        if (currentSessionId === sessionId) {
            currentSessionId = null;
            chatBoxEl.classList.add('hidden');
        }
        loadSessions();
    } catch (e) { console.error(e); }
}

btnNewChatEl.addEventListener('click', async () => {
    try {
        const res = await fetch('/api/chat/sessions', { method: 'POST' });
        const newSession = await res.json();
        selectSession(newSession.id);
        loadSessions();
    } catch (e) { console.error(e); }
});

async function selectSession(sessionId) {
    currentSessionId = sessionId;
    chatBoxEl.classList.remove('hidden');
    loadSessions(); 
    
    try {
        const res = await fetch(`/api/chat/sessions/${sessionId}`);
        const messages = await res.json();
        
        chatMessagesEl.innerHTML = '';
        if (messages.length === 0) {
            chatMessagesEl.innerHTML = '<div class="msg system">這是新的對話。您可以輸入「幫我抽一張牌」來觸發工具，或上傳手掌照片進行手相分析 🖐️</div>';
        } else {
            messages.forEach((msg, idx) => {
                const isLastAssistant = (msg.role === 'assistant' && idx === messages.length - 1);
                appendMessage(msg.role, msg.content, isLastAssistant, msg.image_path);
            });
        }
        scrollToBottom();
    } catch (e) { console.error(e); }
}

/* --- 發送與回答控制 (Abort) --- */
btnSendEl.addEventListener('click', () => {
    if (currentAbortController) {
        currentAbortController.abort();
        resetSendButton();
        appendMessage('system', '⏹️ 已中止回應');
    } else {
        sendMessage();
    }
});

chatInputEl.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !currentAbortController) sendMessage();
});

function setSendButtonAbortMode() {
    btnSendEl.textContent = '⏹️ 中止';
    btnSendEl.classList.add('abort-mode');
}
function resetSendButton() {
    btnSendEl.textContent = '送出';
    btnSendEl.classList.remove('abort-mode');
    currentAbortController = null;
}

async function sendMessage() {
    if (!currentSessionId) return alert('請先選擇或建立一個對話！');
    const text = chatInputEl.value.trim();
    if (!text && !pendingImageFile) return;
    
    // UI 先顯示使用者訊息（含圖片預覽）
    const previewSrc = pendingImageFile && pendingImageFile.type.startsWith('image/') ? imagePreviewEl.src : null;
    appendMessage('user', text || '(已上傳圖片)', false, previewSrc);
    chatInputEl.value = '';
    
    // 清除圖片預覽
    imagePreviewAreaEl.classList.add('hidden');
    imagePreviewEl.src = '';
    scrollToBottom();
    
    // 設定 AbortController
    currentAbortController = new AbortController();
    setSendButtonAbortMode();
    
    try {
        let res;
        if (pendingImageFile) {
            // 使用 FormData 上傳圖片
            const formData = new FormData();
            formData.append('content', text);
            formData.append('image', pendingImageFile);
            res = await fetch(`/api/chat/sessions/${currentSessionId}/messages`, {
                method: 'POST',
                body: formData,
                signal: currentAbortController.signal
            });
        } else {
            // 純文字
            res = await fetch(`/api/chat/sessions/${currentSessionId}/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: text }),
                signal: currentAbortController.signal
            });
        }
        
        pendingImageFile = null;
        fileInputEl.value = '';
        
        // 重新載入這個 Session 的所有訊息以確保包含 Tool Message
        selectSession(currentSessionId); 
        
    } catch (e) {
        if (e.name === 'AbortError') {
            console.log('Fetch aborted by user');
        } else {
            console.error('Failed to send message', e);
            appendMessage('system', '發送失敗，請稍後再試。');
        }
    } finally {
        pendingImageFile = null;
        fileInputEl.value = '';
        resetSendButton();
    }
}

/* --- 重新生成 (Regenerate) --- */
async function regenerateLastResponse() {
    if (!currentSessionId) return;
    
    currentAbortController = new AbortController();
    setSendButtonAbortMode();
    
    appendMessage('system', '🔄 正在重新生成回覆...');
    scrollToBottom();

    try {
        await fetch(`/api/chat/sessions/${currentSessionId}/regenerate`, {
            method: 'POST',
            signal: currentAbortController.signal
        });
        selectSession(currentSessionId);
    } catch (e) {
        if (e.name !== 'AbortError') console.error('Failed to regenerate', e);
    } finally {
        resetSendButton();
    }
}

/* --- UI 渲染 --- */
function appendMessage(role, content, isLastAssistant = false, imagePath = null) {
    if (role === 'system' || role === 'tool') {
        const div = document.createElement('div');
        div.className = `msg ${role}`;
        div.textContent = content;
        chatMessagesEl.appendChild(div);
        return;
    }

    const container = document.createElement('div');
    container.className = `msg-container ${role}`;
    
    const msgDiv = document.createElement('div');
    msgDiv.className = `msg ${role}`;
    
    // 如果有圖片，先渲染圖片
    if (imagePath) {
        const imgEl = document.createElement('img');
        imgEl.className = 'msg-image';
        // 如果是 base64 data URL（即時預覽）或是伺服器路徑
        imgEl.src = imagePath.startsWith('data:') ? imagePath : `/${imagePath}`;
        imgEl.alt = '上傳的圖片';
        imgEl.onclick = () => window.open(imgEl.src, '_blank');
        msgDiv.appendChild(imgEl);
    }
    
    // 渲染文字內容
    if (content) {
        const textDiv = document.createElement('div');
        if (role === 'assistant' && typeof marked !== 'undefined') {
            textDiv.innerHTML = marked.parse(content);
        } else {
            textDiv.textContent = content;
        }
        msgDiv.appendChild(textDiv);
    }
    
    container.appendChild(msgDiv);

    // 如果是最後一個 assistant 訊息，加上「重新生成」按鈕
    if (role === 'assistant' && isLastAssistant) {
        const regenBtn = document.createElement('button');
        regenBtn.className = 'btn-regenerate';
        regenBtn.textContent = '🔄 重新生成';
        regenBtn.onclick = regenerateLastResponse;
        container.appendChild(regenBtn);
    }

    chatMessagesEl.appendChild(container);
    scrollToBottom();
}

function scrollToBottom() {
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

// 初始化載入
loadSessions();
