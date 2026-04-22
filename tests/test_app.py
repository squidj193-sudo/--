import pytest
import sys
import os
import json
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from app import app

@pytest.fixture
def client():
    app.config['TESTING'] = True
    with app.test_client() as client:
        yield client

def test_index_route(client):
    """Test if the index route returns 200 OK and loads the template"""
    response = client.get('/')
    assert response.status_code == 200
    assert b"<!DOCTYPE html>" in response.data or b"<html" in response.data

def test_api_tarot_route(client):
    """Test if the tarot API returns a list of JSON data"""
    response = client.get('/api/tarot')
    assert response.status_code == 200
    data = json.loads(response.data)
    assert isinstance(data, list)

def test_api_tarot_has_cards(client):
    """Test if the tarot API actually loaded cards from JSON"""
    response = client.get('/api/tarot')
    data = json.loads(response.data)
    # 如果找不到檔案，app.py 預設回傳空陣列 []。我們期望有資料。
    assert len(data) > 0, "Tarot data is empty! The JSON file might be missing or misplaced."
