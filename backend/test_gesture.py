import os
import sys

# Add backend directory to sys.path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from ai_engine.vision import analyze_gesture

image_path = r"C:\Users\Admin\.gemini\antigravity\brain\90e2e59f-4d4a-41fa-8296-2d3faba7c763\peace_sign_gesture_1780890372876.png"

print("Analyzing gesture in image:", image_path)
print("--------------------------------------------------")
try:
    result = analyze_gesture(image_path)
    print("Result:")
    print(result)
except Exception as e:
    print("Error:", e)
