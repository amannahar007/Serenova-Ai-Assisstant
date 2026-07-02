import time
import requests
import json

def test_chat():
    url = "http://localhost:8000/chat"
    payload = {
        "message": "what is 2+2",
        "stream": True
    }
    
    start_time = time.time()
    print(f"Sending request at {start_time:.2f}...")
    
    try:
        response = requests.post(url, json=payload, stream=True)
        print(f"Status Code: {response.status_code}")
        first_token = False
        
        for line in response.iter_lines():
            if line:
                if not first_token:
                    ttft = time.time() - start_time
                    print(f"\n[TIME TO FIRST TOKEN]: {ttft:.2f} seconds\n")
                    first_token = True
                print(line.decode('utf-8'))
                
        total_time = time.time() - start_time
        print(f"\n[TOTAL TIME]: {total_time:.2f} seconds")
        
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    test_chat()
