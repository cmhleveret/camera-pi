#!/bin/bash
# Download SSD MobileNet v2 (COCO) compiled for Google Coral Edge TPU
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

MODEL_URL="https://github.com/google-coral/test_data/raw/master/ssd_mobilenet_v2_coco_quant_postprocess_edgetpu.tflite"
LABELS_URL="https://raw.githubusercontent.com/google-coral/test_data/master/coco_labels.txt"

echo "Downloading SSD MobileNet v2 Edge TPU model..."
curl -L -o ssd_mobilenet_v2_coco_quant_postprocess_edgetpu.tflite "$MODEL_URL"

echo "Downloading COCO labels..."
curl -L -o coco_labels.txt "$LABELS_URL"

echo "Done. Model files saved to: $SCRIPT_DIR"
ls -lh *.tflite *.txt
