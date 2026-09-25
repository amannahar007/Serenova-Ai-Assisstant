"""
Face detection and standardization module.
Uses OpenCV Face Cascade and geometric alignment to extract and normalize face regions.
"""

from __future__ import annotations
import os
import cv2
import numpy as np
from typing import Tuple, Optional, List, Dict, Any

MODEL_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_CASCADE_PATH = os.path.join(MODEL_DIR, 'models', 'haarcascade_frontalface_default.xml')

class FaceDetector:
    def __init__(self, cascade_path: str = DEFAULT_CASCADE_PATH, margin_ratio: float = 0.15):
        self.margin_ratio = margin_ratio
        if os.path.exists(cascade_path):
            self.face_cascade = cv2.CascadeClassifier(cascade_path)
        else:
            self.face_cascade = None

    def detect_faces(self, image: np.ndarray) -> List[Dict[str, Any]]:
        """
        Detect faces in image. Returns list of dicts with 'bbox': (x, y, w, h), 'confidence': float
        """
        if image is None or image.size == 0 or self.face_cascade is None:
            return []
            
        if len(image.shape) == 3:
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        else:
            gray = image
            
        # Multi-scale face detection
        faces = self.face_cascade.detectMultiScale(
            gray,
            scaleFactor=1.1,
            minNeighbors=3,
            minSize=(24, 24),
            flags=cv2.CASCADE_SCALE_IMAGE
        )
        
        results = []
        for (x, y, fw, fh) in faces:
            results.append({
                'bbox': (int(x), int(y), int(fw), int(fh)),
                'confidence': 0.95
            })
            
        return results

    def extract_face(self, image: np.ndarray, target_size: Tuple[int, int] = (224, 224)) -> Tuple[np.ndarray, Optional[Tuple[int, int, int, int]]]:
        """
        Extracts primary face with safety margin, converts to RGB, and resizes to target_size.
        If no face is detected (e.g. image is already a cropped face), returns the full image.
        Returns: (processed_face_rgb_224x224, bbox_tuple)
        """
        if image is None or image.size == 0:
            blank = np.zeros((target_size[1], target_size[0], 3), dtype=np.uint8)
            return blank, None

        # Convert to RGB
        if len(image.shape) == 2:
            rgb_img = cv2.cvtColor(image, cv2.COLOR_GRAY2RGB)
        elif image.shape[2] == 4:
            rgb_img = cv2.cvtColor(image, cv2.COLOR_BGRA2RGB)
        elif image.shape[2] == 3:
            rgb_img = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        else:
            rgb_img = image

        h, w = rgb_img.shape[:2]
        faces = self.detect_faces(image)
        
        if len(faces) > 0:
            # Select largest face
            largest_face = max(faces, key=lambda f: f['bbox'][2] * f['bbox'][3])
            x, y, fw, fh = largest_face['bbox']
            
            # Apply safety margin
            mx = int(fw * self.margin_ratio)
            my = int(fh * self.margin_ratio)
            
            x1 = max(0, x - mx)
            y1 = max(0, y - my)
            x2 = min(w, x + fw + mx)
            y2 = min(h, y + fh + my)
            
            face_crop = rgb_img[y1:y2, x1:x2]
            bbox = (x1, y1, x2 - x1, y2 - y1)
        else:
            face_crop = rgb_img
            bbox = (0, 0, w, h)
            
        if face_crop.size == 0:
            face_crop = rgb_img
            bbox = (0, 0, w, h)
            
        resized_face = cv2.resize(face_crop, target_size, interpolation=cv2.INTER_AREA)
        return resized_face, bbox
