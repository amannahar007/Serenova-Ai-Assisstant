"""
5-Fold Stratified Cross-Validation & Fine-Tuning Pipeline for Facial Expression Recognition.
Standardizes images, runs k-fold evaluation, tunes confidence thresholding,
and generates per-class metrics and confusion matrices.
"""

from __future__ import annotations
import os
import sys
import json
import time
import copy
import random
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import seaborn as sns

import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader
from torchvision import transforms
from PIL import Image
from sklearn.model_selection import StratifiedKFold
from sklearn.metrics import classification_report, confusion_matrix, accuracy_score, precision_recall_fscore_support
from transformers import AutoImageProcessor, AutoModelForImageClassification

# Set seed for reproducibility
SEED = 42
random.seed(SEED)
np.random.seed(SEED)
torch.manual_seed(SEED)

BASE_MODEL_NAME = 'dima806/facial_emotions_image_detection'
CLASSES = ['anger', 'disgust', 'fear', 'happy', 'neutral', 'sad', 'surprise']
CLASS_TO_IDX = {cls: idx for idx, cls in enumerate(CLASSES)}
IDX_TO_CLASS = {idx: cls for idx, cls in enumerate(CLASSES)}

class FacialDataset(Dataset):
    def __init__(self, root_dir: str, transform=None):
        self.samples = []
        self.transform = transform
        
        for cls in CLASSES:
            cls_dir = os.path.join(root_dir, cls)
            if not os.path.exists(cls_dir):
                continue
            cls_idx = CLASS_TO_IDX[cls]
            for fname in os.listdir(cls_dir):
                if fname.lower().endswith(('.jpg', '.jpeg', '.png')):
                    self.samples.append((os.path.join(cls_dir, fname), cls_idx))

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        path, label = self.samples[idx]
        image = Image.open(path).convert('RGB')
        if self.transform:
            image = self.transform(image)
        return image, label

val_transform = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
])

def extract_features(model, dataset, device='cpu', batch_size=32):
    """Extract 768-dim embeddings from ViT backbone in a single fast pass."""
    loader = DataLoader(dataset, batch_size=batch_size, shuffle=False)
    features = []
    labels = []
    
    print(f"Extracting features for {len(dataset)} images on {device}...")
    sys.stdout.flush()
    start_t = time.time()
    
    with torch.no_grad():
        for i, (images, targets) in enumerate(loader):
            images = images.to(device)
            # ViT forward pass to extract pooler_output / CLS embeddings
            outputs = model.vit(images)
            # CLS token state: [batch_size, 768]
            cls_feat = outputs.last_hidden_state[:, 0, :]
            features.append(cls_feat.cpu().numpy())
            labels.append(targets.numpy())
            print(f"  Batch {i+1}/{(len(dataset)-1)//batch_size + 1} processed ({(time.time()-start_t):.1f}s)")
            sys.stdout.flush()
            
    features = np.concatenate(features, axis=0)
    labels = np.concatenate(labels, axis=0)
    print(f"Feature extraction completed in {time.time()-start_t:.2f}s. Feature shape: {features.shape}")
    sys.stdout.flush()
    return features, labels

class HeadClassifier(nn.Module):
    def __init__(self, in_features=768, num_classes=7):
        super().__init__()
        self.net = nn.Sequential(
            nn.Dropout(0.25),
            nn.Linear(in_features, 256),
            nn.GELU(),
            nn.Dropout(0.25),
            nn.Linear(256, num_classes)
        )
    def forward(self, x):
        return self.net(x)

def train_and_evaluate_kfold(
    data_dir: str = r'd:\Serenova-Ai-Assisstant-main\Serenova-Ai-Assisstant-main\backend\ai_engine\facial_expression\dataset',
    output_dir: str = r'd:\Serenova-Ai-Assisstant-main\Serenova-Ai-Assisstant-main\backend\ai_engine\facial_expression\models',
    n_splits: int = 5,
    epochs: int = 25,
    lr: float = 2e-3,
    device: str = 'cuda' if torch.cuda.is_available() else 'cpu'
):
    os.makedirs(output_dir, exist_ok=True)
    dataset = FacialDataset(data_dir, transform=val_transform)
    
    print(f"Total dataset samples: {len(dataset)}")
    sys.stdout.flush()
    
    # Load base ViT model
    raw_base = AutoModelForImageClassification.from_pretrained(BASE_MODEL_NAME).to(device)
    raw_base.eval()
    
    # Pre-extract all embeddings
    X, y = extract_features(raw_base, dataset, device=device)
    
    skf = StratifiedKFold(n_splits=n_splits, shuffle=True, random_state=SEED)
    
    fold_accuracies = []
    all_y_true = []
    all_y_pred = []
    all_max_probs = []
    
    best_overall_val_acc = 0.0
    best_head_state = None

    print(f"\n--- Starting {n_splits}-Fold Stratified Cross-Validation ---")
    sys.stdout.flush()

    for fold, (train_idx, val_idx) in enumerate(skf.split(X, y)):
        X_train, y_train = torch.tensor(X[train_idx], dtype=torch.float32), torch.tensor(y[train_idx], dtype=torch.long)
        X_val, y_val = torch.tensor(X[val_idx], dtype=torch.float32), torch.tensor(y[val_idx], dtype=torch.long)
        
        train_dataset = torch.utils.data.TensorDataset(X_train, y_train)
        val_dataset = torch.utils.data.TensorDataset(X_val, y_val)
        
        train_loader = DataLoader(train_dataset, batch_size=16, shuffle=True)
        val_loader = DataLoader(val_dataset, batch_size=16, shuffle=False)
        
        head = HeadClassifier(in_features=768, num_classes=len(CLASSES)).to(device)
        optimizer = torch.optim.AdamW(head.parameters(), lr=lr, weight_decay=1e-3)
        criterion = nn.CrossEntropyLoss()
        
        best_fold_acc = 0.0
        fold_true, fold_pred, fold_probs = [], [], []

        for epoch in range(epochs):
            head.train()
            for bx, by in train_loader:
                bx, by = bx.to(device), by.to(device)
                optimizer.zero_grad()
                logits = head(bx)
                loss = criterion(logits, by)
                loss.backward()
                optimizer.step()

            # Validation
            head.eval()
            cur_true, cur_pred, cur_probs = [], [], []
            with torch.no_grad():
                for bx, by in val_loader:
                    bx, by = bx.to(device), by.to(device)
                    logits = head(bx)
                    probs = torch.softmax(logits, dim=1)
                    max_p, preds = torch.max(probs, dim=1)
                    cur_true.extend(by.cpu().numpy().tolist())
                    cur_pred.extend(preds.cpu().numpy().tolist())
                    cur_probs.extend(max_p.cpu().numpy().tolist())
                    
            val_acc = accuracy_score(cur_true, cur_pred)
            if val_acc >= best_fold_acc:
                best_fold_acc = val_acc
                fold_true = cur_true
                fold_pred = cur_pred
                fold_probs = cur_probs
                if val_acc > best_overall_val_acc:
                    best_overall_val_acc = val_acc
                    best_head_state = copy.deepcopy(head.state_dict())

        fold_accuracies.append(best_fold_acc)
        all_y_true.extend(fold_true)
        all_y_pred.extend(fold_pred)
        all_max_probs.extend(fold_probs)
        print(f"Fold {fold + 1}/{n_splits} Best Accuracy: {best_fold_acc * 100:.2f}%")
        sys.stdout.flush()

    mean_acc = np.mean(fold_accuracies)
    std_acc = np.std(fold_accuracies)
    variance_acc = np.var(fold_accuracies)

    print("\n======================================================")
    print("          CROSS-VALIDATION RESULTS SUMMARY")
    print("======================================================")
    print(f"Folds Accuracies: {[f'{a * 100:.2f}%' for a in fold_accuracies]}")
    print(f"Mean Accuracy:    {mean_acc * 100:.2f}%")
    print(f"Standard Dev:     +/- {std_acc * 100:.2f}%")
    print(f"Variance:         {variance_acc:.6f}")
    print("------------------------------------------------------")
    sys.stdout.flush()

    # Classification Report
    report_dict = classification_report(all_y_true, all_y_pred, target_names=CLASSES, output_dict=True)
    report_text = classification_report(all_y_true, all_y_pred, target_names=CLASSES)
    print("\nDetailed Classification Report:")
    print(report_text)
    sys.stdout.flush()

    # Confusion Matrix
    cm = confusion_matrix(all_y_true, all_y_pred)
    print("\nConfusion Matrix (Rows: Ground Truth, Cols: Predicted):")
    print(cm)
    sys.stdout.flush()

    # Save Confusion Matrix Plot
    plt.figure(figsize=(8, 6))
    sns.heatmap(cm, annot=True, fmt='d', cmap='Blues', xticklabels=CLASSES, yticklabels=CLASSES)
    plt.title(f'5-Fold Cross-Validated Confusion Matrix (Mean Acc: {mean_acc * 100:.2f}%)')
    plt.xlabel('Predicted Expression')
    plt.ylabel('True Expression')
    plt.tight_layout()
    cm_path = os.path.join(output_dir, 'confusion_matrix.png')
    plt.savefig(cm_path, dpi=300)
    plt.close()
    print(f"Saved confusion matrix plot to: {cm_path}")
    sys.stdout.flush()

    # Confidence Threshold Calibration Analysis
    print("\nConfidence Threshold Fallback Calibration:")
    thresholds = [0.40, 0.50, 0.60, 0.65, 0.70, 0.75, 0.80, 0.85]
    threshold_analysis = []
    
    for th in thresholds:
        accepted_indices = [i for i, p in enumerate(all_max_probs) if p >= th]
        uncertain_count = len(all_max_probs) - len(accepted_indices)
        if accepted_indices:
            acc_th = accuracy_score([all_y_true[i] for i in accepted_indices], [all_y_pred[i] for i in accepted_indices])
        else:
            acc_th = 0.0
        pct_accepted = (len(accepted_indices) / len(all_max_probs)) * 100
        threshold_analysis.append({
            'threshold': th,
            'accepted_accuracy': round(acc_th * 100, 2),
            'accepted_pct': round(pct_accepted, 1),
            'uncertain_count': uncertain_count
        })
        print(f"  Threshold >= {th:.2f} -> Accuracy on Accepted: {acc_th * 100:.2f}% | Retained: {pct_accepted:.1f}% | Uncertain: {uncertain_count}/{len(all_max_probs)}")
    sys.stdout.flush()

    # Save Final Model Checkpoint
    final_head = HeadClassifier(in_features=768, num_classes=len(CLASSES))
    if best_head_state is not None:
        final_head.load_state_dict(best_head_state)
    
    # Integrate into final model structure for easy inference
    raw_base.classifier = final_head.net
    head_save_path = os.path.join(output_dir, 'fer_head.pt')
    torch.save({
        'classifier_state_dict': final_head.net.state_dict(),
        'classes': CLASSES,
        'class_to_idx': CLASS_TO_IDX,
        'idx_to_class': IDX_TO_CLASS,
        'base_model': BASE_MODEL_NAME,
        'recommended_threshold': 0.65,
        'mean_cv_accuracy': float(mean_acc),
        'std_cv_accuracy': float(std_acc)
    }, head_save_path)
    print(f"\nSaved compact model checkpoint to: {head_save_path}")

    model_save_path = os.path.join(output_dir, 'fer_model.pt')
    torch.save({
        'model_state_dict': raw_base.state_dict(),
        'classes': CLASSES,
        'class_to_idx': CLASS_TO_IDX,
        'idx_to_class': IDX_TO_CLASS,
        'base_model': BASE_MODEL_NAME,
        'recommended_threshold': 0.65,
        'mean_cv_accuracy': float(mean_acc),
        'std_cv_accuracy': float(std_acc)
    }, model_save_path)
    print(f"Saved full model checkpoint to: {model_save_path}")

    # Save metrics JSON
    metrics_summary = {
        'n_splits': n_splits,
        'fold_accuracies': [float(a) for a in fold_accuracies],
        'mean_accuracy': float(mean_acc),
        'std_accuracy': float(std_acc),
        'variance': float(variance_acc),
        'classification_report': report_dict,
        'confusion_matrix': cm.tolist(),
        'threshold_calibration': threshold_analysis,
        'classes': CLASSES
    }
    metrics_path = os.path.join(output_dir, 'metrics.json')
    with open(metrics_path, 'w', encoding='utf-8') as f:
        json.dump(metrics_summary, f, indent=2)
    print(f"Saved metrics summary to: {metrics_path}")
    sys.stdout.flush()

    return metrics_summary

if __name__ == '__main__':
    train_and_evaluate_kfold()
