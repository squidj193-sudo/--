from flask import Flask, render_template, jsonify
import json
import os

app = Flask(__name__)

# 載入塔羅牌資料庫
def load_tarot_data():
    data_path = os.path.join(app.root_path, 'data', 'tarot.json')
    try:
        with open(data_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        return []

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/tarot')
def api_tarot():
    data = load_tarot_data()
    return jsonify(data)

if __name__ == '__main__':
    app.run(debug=True)
