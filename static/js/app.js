let tarotData = [];
let selectedMode = ''; // 'single' or 'three'
let selectedCards = [];

// DOM Elements
const btnSingle = document.getElementById('btn-single');
const btnThree = document.getElementById('btn-three');
const btnShuffle = document.getElementById('btn-shuffle');
const deckArea = document.getElementById('deck-area');
const resultArea = document.getElementById('result-area');

// 載入塔羅資料
async function loadData() {
    try {
        const response = await fetch('/api/tarot');
        tarotData = await response.json();
    } catch (error) {
        console.error('Error loading tarot data:', error);
    }
}

// 初始化
loadData();

btnSingle.addEventListener('click', () => startReading('single'));
btnThree.addEventListener('click', () => startReading('three'));
btnShuffle.addEventListener('click', shuffleDeck);

function startReading(mode) {
    selectedMode = mode;
    selectedCards = [];
    btnSingle.classList.add('hidden');
    btnThree.classList.add('hidden');
    btnShuffle.classList.remove('hidden');
    resultArea.classList.add('hidden');
    resultArea.innerHTML = '';
}

function shuffleDeck() {
    btnShuffle.classList.add('hidden');
    deckArea.classList.remove('hidden');
    deckArea.innerHTML = '';
    
    // 產生牌背
    for (let i = 0; i < 22; i++) { // MVP 暫時只用22張牌展示
        const cardObj = document.createElement('div');
        cardObj.className = 'card-back';
        cardObj.addEventListener('click', () => selectCard(cardObj));
        deckArea.appendChild(cardObj);
    }
}

function selectCard(cardElement) {
    const requiredCards = selectedMode === 'single' ? 1 : 3;
    if (selectedCards.length >= requiredCards) return;
    
    cardElement.style.visibility = 'hidden'; // 隱藏已選的牌背
    
    // 隨機選出一張牌
    const randomIndex = Math.floor(Math.random() * tarotData.length);
    const card = tarotData[randomIndex];
    const isReversed = Math.random() > 0.5; // 50% 正逆位
    
    selectedCards.push({ ...card, isReversed });
    
    if (selectedCards.length === requiredCards) {
        setTimeout(showResults, 500);
    }
}

function showResults() {
    deckArea.classList.add('hidden');
    resultArea.classList.remove('hidden');
    
    const positions = selectedMode === 'single' ? ['每日指引'] : ['過去', '現在', '未來'];
    
    selectedCards.forEach((card, index) => {
        const cardHtml = `
            <div class="card-result">
                <div class="position-title">${positions[index]}</div>
                <div class="card-image-placeholder ${card.isReversed ? 'reversed' : ''}">
                    ${card.name}<br>(圖片區)
                </div>
                <h3>${card.name} ${card.isReversed ? '(逆位)' : '(正位)'}</h3>
                <p><strong>關鍵字:</strong> ${card.keywords.join(', ')}</p>
                <p>${card.isReversed ? card.meaning_rev : card.meaning_up}</p>
            </div>
        `;
        resultArea.innerHTML += cardHtml;
    });

    // 重新開始按鈕
    const restartBtn = document.createElement('button');
    restartBtn.className = 'btn';
    restartBtn.textContent = '重新占卜';
    restartBtn.style.width = '100%';
    restartBtn.style.marginTop = '20px';
    restartBtn.addEventListener('click', () => {
        resultArea.classList.add('hidden');
        btnSingle.classList.remove('hidden');
        btnThree.classList.remove('hidden');
    });
    resultArea.appendChild(restartBtn);
}
