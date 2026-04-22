from flask import Flask, render_template, jsonify, request
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
from dotenv import load_dotenv
import google.generativeai as genai
import json
import os
import uuid
import random
import time
from werkzeug.utils import secure_filename
import base64

load_dotenv()
if os.environ.get("GEMINI_API_KEY"):
    genai.configure(api_key=os.environ["GEMINI_API_KEY"])

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///chat.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['UPLOAD_FOLDER'] = os.path.join(app.root_path, 'static', 'uploads')
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'txt'}
db = SQLAlchemy(app)

# --- 資料庫模型 (SQLite) ---
class UserPreference(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    content = db.Column(db.Text, nullable=False, default="")
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class ChatSession(db.Model):
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    messages = db.relationship('ChatMessage', backref='session', lazy=True, cascade="all, delete-orphan")

class ChatMessage(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    session_id = db.Column(db.String(36), db.ForeignKey('chat_session.id'), nullable=False)
    role = db.Column(db.String(20), nullable=False) # 'user', 'assistant', 'system', 'tool'
    content = db.Column(db.Text, nullable=False)
    image_path = db.Column(db.String(500), nullable=True)  # 圖片路徑
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

# 建立資料庫
with app.app_context():
    db.create_all()

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

# --- 塔羅牌資料與內部工具 (Tool Use) ---
def load_tarot_data():
    data_path = os.path.join(app.root_path, 'data', 'tarot.json')
    try:
        with open(data_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        return []

def draw_tarot_card(count=1):
    cards = load_tarot_data()
    if not cards:
        return "無法抽牌，資料庫為空。"
    drawn = random.sample(cards, min(count, len(cards)))
    results = []
    for c in drawn:
        is_rev = random.choice([True, False])
        state = "逆位" if is_rev else "正位"
        results.append(f"{c['name']} ({state})")
    return "，".join(results)

# --- 基本路由 ---
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/tarot')
def api_tarot():
    data = load_tarot_data()
    return jsonify(data)

# --- 記憶機制 API (Memory) ---
@app.route('/api/memory', methods=['GET', 'POST'])
def handle_memory():
    pref = UserPreference.query.first()
    if request.method == 'GET':
        return jsonify({'content': pref.content if pref else ""})
    
    if request.method == 'POST':
        content = request.json.get('content', '')
        if not pref:
            pref = UserPreference(content=content)
            db.session.add(pref)
        else:
            pref.content = content
        db.session.commit()
        return jsonify({'status': 'success'})

# --- 對話狀態管理 API ---
@app.route('/api/chat/sessions', methods=['GET'])
def get_sessions():
    sessions = ChatSession.query.order_by(ChatSession.created_at.desc()).all()
    return jsonify([{'id': s.id, 'created_at': s.created_at.isoformat()} for s in sessions])

@app.route('/api/chat/sessions', methods=['POST'])
def create_session():
    new_session = ChatSession()
    db.session.add(new_session)
    db.session.commit()
    return jsonify({'id': new_session.id, 'created_at': new_session.created_at.isoformat()}), 201

@app.route('/api/chat/sessions/<session_id>', methods=['DELETE'])
def delete_session(session_id):
    session_to_delete = ChatSession.query.get(session_id)
    if session_to_delete:
        db.session.delete(session_to_delete)
        db.session.commit()
        return jsonify({'message': 'Deleted successfully'}), 200
    return jsonify({'error': 'Session not found'}), 404

@app.route('/api/chat/sessions/<session_id>', methods=['GET'])
def get_session_messages(session_id):
    messages = ChatMessage.query.filter_by(session_id=session_id).order_by(ChatMessage.created_at.asc()).all()
    return jsonify([{
        'id': m.id, 'role': m.role, 'content': m.content,
        'image_path': m.image_path,
        'created_at': m.created_at.isoformat()
    } for m in messages])

def _generate_assistant_response(session_id, user_msg):
    pref = UserPreference.query.first()
    memory_ctx = f"這是一次塔羅牌占卜的對話。使用者的個人偏好與背景設定如下：\n{pref.content}\n請在對話中適時地參考這個背景。" if pref and pref.content else "你是一位專業的神祕學塔羅解讀師。請根據塔羅牌結果進行深度解讀。"
    
    user_content = user_msg.content
    tool_msg = None
    has_image = user_msg.image_path is not None
    
    # 手相分析偵測
    is_palm_reading = has_image and ("手相" in user_content or "看手" in user_content or "掌紋" in user_content or "palm" in user_content.lower())
    if has_image and not is_palm_reading and user_content.strip() == "":
        # 如果只上傳了圖片但沒有文字，預設當作手相分析
        is_palm_reading = True
        user_content = "請幫我分析這張手相照片"

    # 意圖判斷與工具執行 (Tool Use)
    if "抽牌" in user_content or "抽一張牌" in user_content:
        card_res = draw_tarot_card(1)
        tool_msg = ChatMessage(session_id=session_id, role='tool', content=f"執行抽牌工具：為你抽出了 {card_res}")
        db.session.add(tool_msg)
        db.session.commit()
        user_content_for_ai = f"{user_content}\n\n[系統自動抽牌結果：{card_res}。請根據此結果進行塔羅解讀。]"
    elif is_palm_reading:
        tool_msg = ChatMessage(session_id=session_id, role='tool', content="執行手相分析工具：正在使用 AI 視覺分析手掌影像...")
        db.session.add(tool_msg)
        db.session.commit()
        user_content_for_ai = f"{user_content}\n\n[系統已偵測到手掌影像。請以專業手相師的角度，詳細分析這張手相照片中的生命線、智慧線、感情線、事業線等掌紋特徵，並結合神祕學的觀點，提供全面的手相解讀報告。請使用 Markdown 格式排版，分段落與重點標示。]"
    else:
        user_content_for_ai = user_content

    # 若未設定金鑰，退回模擬模式
    if not os.environ.get("GEMINI_API_KEY"):
        time.sleep(1.5)
        memory_str = f" [💡AI 讀取了你的記憶：{pref.content}]" if pref and pref.content else ""
        if is_palm_reading:
            return f"我收到了你的手掌影像！{memory_str} 讓我為你進行手相分析... (此為模擬回覆，請在 .env 設定 GEMINI_API_KEY 以啟用真實 AI 手相分析)", tool_msg
        if tool_msg and not is_palm_reading:
            return f"我使用了抽牌工具，結果是「{card_res}」。{memory_str} 結合你的背景，這代表著一個新的開始。需要為你詳細解讀嗎？ (此為模擬回覆，請在 .env 設定 GEMINI_API_KEY)", tool_msg
        if has_image:
            return f"我已收到你上傳的圖片，並理解你的問題：「{user_content}」。{memory_str} (此為模擬回覆，請在 .env 設定 GEMINI_API_KEY)", None
        return f"我已經理解你的問題：「{user_content}」。{memory_str} (此為模擬回覆，請在 .env 設定 GEMINI_API_KEY)", tool_msg

    # 串接 Gemini 2.5 Flash (強制使用)
    try:
        messages = ChatMessage.query.filter_by(session_id=session_id).order_by(ChatMessage.created_at.asc()).all()
        
        history_for_gemini = []
        for m in messages:
            if m.id == user_msg.id or (tool_msg and m.id == tool_msg.id):
                continue
                
            if m.role == 'tool':
                history_for_gemini.append({'role': 'user', 'parts': [f"[系統歷史紀錄/工具結果] {m.content}"]})
            elif m.role == 'user':
                history_for_gemini.append({'role': 'user', 'parts': [m.content]})
            elif m.role == 'assistant':
                history_for_gemini.append({'role': 'model', 'parts': [m.content]})
        
        # 構建本次發送的內容 (支援圖片)
        parts = [user_content_for_ai]
        if has_image:
            img_abs_path = os.path.join(app.root_path, user_msg.image_path)
            if os.path.exists(img_abs_path):
                img_data = open(img_abs_path, 'rb').read()
                ext = user_msg.image_path.rsplit('.', 1)[1].lower()
                mime_map = {'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png', 'gif': 'image/gif', 'webp': 'image/webp'}
                mime = mime_map.get(ext, 'image/jpeg')
                parts.append({'mime_type': mime, 'data': img_data})
        
        model = genai.GenerativeModel('gemini-2.5-flash', system_instruction=memory_ctx)
        chat = model.start_chat(history=history_for_gemini)
        response = chat.send_message(parts)
        return response.text, tool_msg
    except Exception as e:
        return f"串接 AI 發生錯誤：{str(e)}", tool_msg

@app.route('/api/chat/sessions/<session_id>/messages', methods=['POST'])
def add_message(session_id):
    # 支援 multipart/form-data (含圖片上傳) 與 JSON
    if request.content_type and 'multipart/form-data' in request.content_type:
        user_content = request.form.get('content', '').strip()
        file = request.files.get('image')
    else:
        data = request.json
        user_content = data.get('content', '').strip()
        file = None

    if not user_content and not file:
        return jsonify({'error': 'Content or image is required'}), 400

    # 處理圖片上傳
    image_path = None
    if file and allowed_file(file.filename):
        filename = f"{uuid.uuid4().hex}_{secure_filename(file.filename)}"
        save_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(save_path)
        image_path = f"static/uploads/{filename}"

    if not user_content:
        user_content = "請幫我分析這張圖片"

    user_msg = ChatMessage(session_id=session_id, role='user', content=user_content, image_path=image_path)
    db.session.add(user_msg)
    db.session.commit()
    
    ai_response_text, tool_msg = _generate_assistant_response(session_id, user_msg)
    
    ai_msg = ChatMessage(session_id=session_id, role='assistant', content=ai_response_text)
    db.session.add(ai_msg)
    db.session.commit()
    
    response_data = {
        'user_message': {'role': 'user', 'content': user_content, 'image_path': image_path},
        'assistant_message': {'role': 'assistant', 'content': ai_response_text}
    }
    if tool_msg:
        response_data['tool_message'] = {'role': 'tool', 'content': tool_msg.content}
        
    return jsonify(response_data), 201

@app.route('/api/chat/sessions/<session_id>/regenerate', methods=['POST'])
def regenerate(session_id):
    messages = ChatMessage.query.filter_by(session_id=session_id).order_by(ChatMessage.created_at.asc()).all()
    if not messages or messages[-1].role != 'assistant':
        return jsonify({'error': '最後一筆不是 AI 回覆，無法重新生成'}), 400
    
    msg_to_delete = messages[-1]
    db.session.delete(msg_to_delete)
    
    user_msg = None
    for m in reversed(messages[:-1]):
        if m.role == 'user':
            user_msg = m
            break
            
    db.session.commit()
    
    ai_response_text, tool_msg = _generate_assistant_response(session_id, user_msg)
    ai_msg = ChatMessage(session_id=session_id, role='assistant', content=ai_response_text)
    db.session.add(ai_msg)
    db.session.commit()

    response_data = {'assistant_message': {'role': 'assistant', 'content': ai_msg.content}}
    if tool_msg:
        response_data['tool_message'] = {'role': 'tool', 'content': tool_msg.content}
        
    return jsonify(response_data), 200

if __name__ == '__main__':
    app.run(debug=True)
