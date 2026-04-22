let currentSessionId = null;
let currentAbortController = null; // 用於「中止回應」

// DOM Elements
const sessionListEl = document.getElementById('session-list');
const chatBoxEl = document.getElementById('chat-box');
const chatMessagesEl = document.getElementById('chat-messages');
const chatInputEl = document.getElementById('chat-input');
const btnSendEl = document.getElementById('btn-send');
const btnNewChatEl = document.getElementById('btn-new-chat');

// Memory DOM
const btnMemoryEl = document.getElementById('btn-memory');
const memoryModalEl = document.getElementById('memory-modal');
const memoryTextEl = document.getElementById('memory-text');
const btnSaveMemoryEl = document.getElementById('btn-save-memory');
const btnCloseMemoryEl = document.getElementById('btn-close-memory');

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
            chatMessagesEl.innerHTML = '<div class="msg system">這是新的對話。您可以輸入「幫我抽一張牌」來觸發工具。</div>';
        } else {
            messages.forEach((msg, idx) => {
                const isLastAssistant = (msg.role === 'assistant' && idx === messages.length - 1);
                appendMessage(msg.role, msg.content, isLastAssistant);
            });
        }
        scrollToBottom();
    } catch (e) { console.error(e); }
}

/* --- 發送與回答控制 (Abort) --- */
btnSendEl.addEventListener('click', () => {
    if (currentAbortController) {
        // 如果正在等待回應，此按鈕為「中止」功能
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
    if (!text) return;
    
    // UI 先顯示使用者訊息
    appendMessage('user', text);
    chatInputEl.value = '';
    scrollToBottom();
    
    // 設定 AbortController
    currentAbortController = new AbortController();
    setSendButtonAbortMode();
    
    try {
        const res = await fetch(`/api/chat/sessions/${currentSessionId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: text }),
            signal: currentAbortController.signal
        });
        
        const data = await res.json();
        
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
        resetSendButton();
    }
}

/* --- 重新生成 (Regenerate) --- */
async function regenerateLastResponse() {
    if (!currentSessionId) return;
    
    // 設定 AbortController (雖然不一定會取消成功，但維持介面一致)
    currentAbortController = new AbortController();
    setSendButtonAbortMode();
    
    // 在畫面上暫時顯示正在重新生成
    appendMessage('system', '🔄 正在重新生成回覆...');
    scrollToBottom();

    try {
        await fetch(`/api/chat/sessions/${currentSessionId}/regenerate`, {
            method: 'POST',
            signal: currentAbortController.signal
        });
        // 重新載入 Session
        selectSession(currentSessionId);
    } catch (e) {
        if (e.name !== 'AbortError') console.error('Failed to regenerate', e);
    } finally {
        resetSendButton();
    }
}

/* --- UI 渲染 --- */
function appendMessage(role, content, isLastAssistant = false) {
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
    
    // 支援 Markdown 解析
    if (role === 'assistant' && typeof marked !== 'undefined') {
        msgDiv.innerHTML = marked.parse(content);
    } else {
        msgDiv.textContent = content;
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
