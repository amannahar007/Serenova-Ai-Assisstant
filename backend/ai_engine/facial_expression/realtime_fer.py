"""
Real-Time Threaded Facial Expression Recognition Pipeline.
Uses OpenCV webcam capture on a dedicated thread, face extraction,
and deep neural expression classification with confidence thresholding and FPS overlay.
"""

from __future__ import annotations
import os
import sys
import time
import queue
import threading
from typing import Tuple, Dict, Any, Optional, List
import cv2
import numpy as np
import torch
import torch.nn as nn
from PIL import Image
from transformers import AutoImageProcessor, AutoModelForImageClassification

# Local imports
from face_detector import FaceDetector

MODEL_DIR = os.path.dirname(os.path.abspath(__file__))
CHECKPOINT_HEAD_PATH = os.path.join(MODEL_DIR, 'models', 'fer_head.pt')
CHECKPOINT_FULL_PATH = os.path.join(MODEL_DIR, 'models', 'fer_model.pt')
BASE_MODEL_NAME = 'dima806/facial_emotions_image_detection'

class FacialExpressionRecognizer:
    def __init__(
        self,
        checkpoint_path: Optional[str] = None,
        confidence_threshold: float = 0.65,
        device: Optional[str] = None
    ):
        self.device = device or ('cuda' if torch.cuda.is_available() else 'cpu')
        self.confidence_threshold = confidence_threshold
        self.face_detector = FaceDetector()
        
        self.classes = ['anger', 'disgust', 'fear', 'happy', 'neutral', 'sad', 'surprise']
        self.idx_to_class = {i: c for i, c in enumerate(self.classes)}
        
        # Initialize model
        self.model = AutoModelForImageClassification.from_pretrained(BASE_MODEL_NAME)
        self.model.classifier = nn.Sequential(
            nn.Dropout(0.25),
            nn.Linear(768, 256),
            nn.GELU(),
            nn.Dropout(0.25),
            nn.Linear(256, len(self.classes))
        )
        
        target_ckpt = checkpoint_path or (CHECKPOINT_HEAD_PATH if os.path.exists(CHECKPOINT_HEAD_PATH) else CHECKPOINT_FULL_PATH)
        if os.path.exists(target_ckpt):
            try:
                ckpt = torch.load(target_ckpt, map_location=self.device)
                if 'classifier_state_dict' in ckpt:
                    self.model.classifier.load_state_dict(ckpt['classifier_state_dict'])
                elif 'model_state_dict' in ckpt:
                    self.model.load_state_dict(ckpt['model_state_dict'])
                self.classes = ckpt.get('classes', self.classes)
                self.idx_to_class = ckpt.get('idx_to_class', self.idx_to_class)
                self.confidence_threshold = ckpt.get('recommended_threshold', self.confidence_threshold)
                print(f"[FER] Loaded fine-tuned checkpoint from: {target_ckpt}")
            except Exception as e:
                print(f"[FER] Warning loading checkpoint: {e}. Using base classifier.")
        else:
            print("[FER] No checkpoint found at specified path.")

        self.model.to(self.device)
        self.model.eval()

        self.processor = AutoImageProcessor.from_pretrained(BASE_MODEL_NAME)
        
        # Warmup forward pass
        dummy = torch.zeros((1, 3, 224, 224), device=self.device)
        with torch.no_grad():
            self.model(dummy)

    def predict_frame(self, frame_bgr: np.ndarray) -> Dict[str, Any]:
        """
        Processes a single BGR frame from OpenCV or web upload.
        Returns:
            {
                'expression': str,
                'confidence': float,
                'is_recognized': bool,
                'status': 'recognized' | 'uncertain / expression not recognized' | 'no_face_detected',
                'probabilities': {class_name: float},
                'bbox': (x, y, w, h) or None
            }
        """
        if frame_bgr is None or frame_bgr.size == 0:
            return {
                'expression': 'uncertain / expression not recognized',
                'confidence': 0.0,
                'is_recognized': False,
                'status': 'no_frame',
                'probabilities': {},
                'bbox': None
            }

        face_rgb, bbox = self.face_detector.extract_face(frame_bgr, target_size=(224, 224))
        
        # Prepare tensor
        pil_img = Image.fromarray(face_rgb)
        inputs = self.processor(images=pil_img, return_tensors='pt').to(self.device)
        
        with torch.no_grad():
            outputs = self.model(inputs.pixel_values)
            probs = torch.softmax(outputs.logits, dim=1)[0].cpu().numpy()
            
        top_idx = int(np.argmax(probs))
        top_conf = float(probs[top_idx])
        top_expr = self.idx_to_class[top_idx]
        
        is_recognized = top_conf >= self.confidence_threshold
        status = top_expr if is_recognized else "uncertain / expression not recognized"

        prob_dict = {self.idx_to_class[i]: round(float(probs[i]), 4) for i in range(len(self.classes))}

        return {
            'expression': top_expr if is_recognized else 'uncertain / expression not recognized',
            'raw_expression': top_expr,
            'confidence': round(top_conf, 4),
            'is_recognized': is_recognized,
            'status': status,
            'probabilities': prob_dict,
            'bbox': bbox
        }


class WebcamStream:
    """Threaded Video Capture for high FPS non-blocking streaming."""
    def __init__(self, src: int = 0):
        self.cap = cv2.VideoCapture(src)
        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
        self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        self.ret, self.frame = self.cap.read()
        self.stopped = False

    def start(self):
        t = threading.Thread(target=self.update, args=(), daemon=True)
        t.start()
        return self

    def update(self):
        while not self.stopped:
            if not self.cap.isOpened():
                break
            ret, frame = self.cap.read()
            if ret:
                self.frame = frame
                self.ret = ret
            time.sleep(0.005)

    def read(self):
        return self.frame

    def stop(self):
        self.stopped = True
        if self.cap.isOpened():
            self.cap.release()


def run_realtime_inference(camera_id: int = 0, threshold: float = 0.65):
    """
    Runs interactive real-time webcam inference with graphical HUD overlay.
    """
    print(f"Initializing Real-Time Facial Expression Pipeline (Camera ID: {camera_id})...")
    recognizer = FacialExpressionRecognizer(confidence_threshold=threshold)
    
    stream = WebcamStream(src=camera_id).start()
    time.sleep(1.0) # Warm up camera
    
    frame = stream.read()
    if frame is None:
        print("[Error] Unable to open webcam video feed. (Camera not accessible or in use).")
        stream.stop()
        return

    print("Pipeline active! Press 'q' or 'ESC' in the window to quit, 's' to save snapshot.")
    
    prev_time = time.time()
    fps_smooth = 0.0
    
    COLOR_CONFIDENT = (0, 230, 80)    # Green
    COLOR_UNCERTAIN = (0, 165, 255)   # Amber / Orange
    COLOR_BG = (20, 20, 20)
    COLOR_TEXT = (255, 255, 255)
    
    frame_count = 0
    cached_result = None

    try:
        while True:
            frame = stream.read()
            if frame is None:
                continue

            frame_count += 1
            curr_time = time.time()
            dt = curr_time - prev_time
            prev_time = curr_time
            if dt > 0:
                fps = 1.0 / dt
                fps_smooth = 0.9 * fps_smooth + 0.1 * fps if fps_smooth > 0 else fps

            # Run inference
            if frame_count % 1 == 0 or cached_result is None:
                cached_result = recognizer.predict_frame(frame)

            res = cached_result
            bbox = res.get('bbox')
            is_rec = res.get('is_recognized', False)
            expr = res.get('expression', 'Unknown')
            conf = res.get('confidence', 0.0)
            
            box_color = COLOR_CONFIDENT if is_rec else COLOR_UNCERTAIN

            # Draw Face Bounding Box & Label
            if bbox and bbox != (0, 0, frame.shape[1], frame.shape[0]):
                x, y, w, h = bbox
                cv2.rectangle(frame, (x, y), (x + w, y + h), box_color, 2)
                
                label_text = f"{expr.upper()} ({conf*100:.1f}%)" if is_rec else f"UNCERTAIN ({conf*100:.1f}%)"
                (tw, th), _ = cv2.getTextSize(label_text, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2)
                cv2.rectangle(frame, (x, y - th - 10), (x + tw + 10, y), box_color, -1)
                cv2.putText(frame, label_text, (x + 5, y - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 2)

            # Draw HUD Overlay Panel (top left)
            overlay = frame.copy()
            cv2.rectangle(overlay, (10, 10), (320, 190), COLOR_BG, -1)
            cv2.addWeighted(overlay, 0.75, frame, 0.25, 0, frame)
            
            # FPS and Status Text
            cv2.putText(frame, f"FPS: {fps_smooth:.1f}", (20, 35), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2)
            cv2.putText(frame, f"Threshold: {threshold:.2f}", (170, 35), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 200, 200), 1)

            # Top emotion probabilities breakdown
            probs = res.get('probabilities', {})
            sorted_probs = sorted(probs.items(), key=lambda item: item[1], reverse=True)[:4]
            
            y_offset = 65
            for emotion, p in sorted_probs:
                cv2.putText(frame, f"{emotion:10s}", (20, y_offset), cv2.FONT_HERSHEY_SIMPLEX, 0.45, COLOR_TEXT, 1)
                bar_len = int(p * 130)
                bar_col = box_color if emotion == res.get('raw_expression') else (120, 120, 120)
                cv2.rectangle(frame, (120, y_offset - 10), (120 + bar_len, y_offset - 2), bar_col, -1)
                cv2.putText(frame, f"{p*100:4.1f}%", (260, y_offset), cv2.FONT_HERSHEY_SIMPLEX, 0.45, COLOR_TEXT, 1)
                y_offset += 25

            cv2.imshow("SERENOVA Facial Expression Recognition", frame)
            
            key = cv2.waitKey(1) & 0xFF
            if key in [ord('q'), 27]: # 'q' or ESC
                break
            elif key == ord('s'):
                snap_path = f"snapshot_{int(time.time())}.jpg"
                cv2.imwrite(snap_path, frame)
                print(f"[Snapshot] Saved to {snap_path}")

    finally:
        stream.stop()
        cv2.destroyAllWindows()
        print("Real-time inference session ended.")

if __name__ == '__main__':
    run_realtime_inference()
