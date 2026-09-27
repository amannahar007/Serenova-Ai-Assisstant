#!/usr/bin/env bash
# Exit immediately on error
set -o errexit

pip install --upgrade pip
# Install CPU-specific PyTorch to keep slug size and memory footprint low on Render
pip install --no-cache-dir -r requirements.txt --extra-index-url https://download.pytorch.org/whl/cpu
