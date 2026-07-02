import urllib.request
import json
req = urllib.request.Request('http://localhost:8000/chat', data=b'{"message": "Hello", "stream": true}', headers={'Content-Type': 'application/json'})
try:
    with urllib.request.urlopen(req) as f:
        print(f.read().decode('utf-8'))
except Exception as e:
    print(e)
