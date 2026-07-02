import requests
import json
import time

def test_frontend_fetch():
    url = "http://localhost:8000/chat"
    payload = {
        "message": "what is 2+2",
        "session_id": "test-session-123",
        "stream": True
    }
    headers = {
        "Content-Type": "application/json",
        "Origin": "http://localhost:5173"
    }
    
    print("Sending fetch request from simulated frontend...")
    start = time.time()
    try:
        with requests.post(url, json=payload, headers=headers, stream=True) as response:
            print(f"Status Code: {response.status_code}")
            print(f"Headers: {response.headers}")
            for line in response.iter_lines():
                if line:
                    print(f"[{time.time()-start:.2f}s] {line.decode('utf-8')}")
    except Exception as e:
        print(f"Fetch failed: {e}")

if __name__ == "__main__":
    test_frontend_fetch()
