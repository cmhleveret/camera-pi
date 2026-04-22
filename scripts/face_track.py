import os
import time
import threading
import logging
from typing import List, Tuple, Optional

import cv2
import numpy as np
import requests
from flask import Flask, Response

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

def env_bool(key: str, default: str = "true") -> bool:
    return os.environ.get(key, default).lower() in ("true", "1", "yes")

# Stream settings (kept from original)
STREAM_URL = os.environ.get("FACETRACK_STREAM_URL", "http://127.0.0.1:8080/stream.mjpg")
HOST = os.environ.get("FACETRACK_HOST", "0.0.0.0")
PORT = int(os.environ.get("FACETRACK_PORT", "8081"))
DETECT_EVERY_N = int(os.environ.get("FACETRACK_DETECT_EVERY_N", "1"))
MIN_SCORE = float(os.environ.get("FACETRACK_MIN_SCORE", "0.5"))

# Model
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_MODEL = os.path.join(SCRIPT_DIR, "models", "ssd_mobilenet_v2_coco_quant_postprocess_edgetpu.tflite")
DEFAULT_LABELS = os.path.join(SCRIPT_DIR, "models", "coco_labels.txt")
MODEL_PATH = os.environ.get("FACETRACK_MODEL_PATH", DEFAULT_MODEL)
LABELS_PATH = os.environ.get("FACETRACK_LABELS_PATH", DEFAULT_LABELS)

# Tracking
TRACK_ENABLED = env_bool("TRACK_ENABLED", "true")
TRACK_SERVO_API = os.environ.get("TRACK_SERVO_API_URL", "http://127.0.0.1:3000/api/servo")
TRACK_PAN_CH = int(os.environ.get("TRACK_PAN_CHANNEL", "0"))
TRACK_TILT_CH = int(os.environ.get("TRACK_TILT_CHANNEL", "1"))
TRACK_SPEED_PAN = float(os.environ.get("TRACK_SPEED_PAN", "3.0"))
TRACK_SPEED_TILT = float(os.environ.get("TRACK_SPEED_TILT", "2.0"))
TRACK_DEADZONE = float(os.environ.get("TRACK_DEADZONE", "0.05"))
TRACK_INVERT_PAN = env_bool("TRACK_INVERT_PAN", "false")
TRACK_INVERT_TILT = env_bool("TRACK_INVERT_TILT", "false")
TRACK_LOST_TIMEOUT = float(os.environ.get("TRACK_LOST_TIMEOUT", "2.0"))
TRACK_HOME_PAN = float(os.environ.get("TRACK_HOME_PAN", "90"))
TRACK_HOME_TILT = float(os.environ.get("TRACK_HOME_TILT", "90"))
TRACK_RETURN_HOME = env_bool("TRACK_RETURN_HOME", "true")

PERSON_CLASS_ID = 0

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("face_track")

app = Flask(__name__)

# ---------------------------------------------------------------------------
# Coral TPU detection (using ai-edge-litert)
# ---------------------------------------------------------------------------

def load_interpreter():
    from ai_edge_litert.interpreter import Interpreter, load_delegate

    if not os.path.exists(MODEL_PATH):
        raise RuntimeError(
            f"Model not found at {MODEL_PATH}. Run scripts/models/download_model.sh first."
        )

    # Try to load with Edge TPU delegate
    edgetpu_lib = None
    for lib_path in (
        "libedgetpu.so.1",
        "/usr/lib/aarch64-linux-gnu/libedgetpu.so.1",
        "/usr/lib/arm-linux-gnueabihf/libedgetpu.so.1",
    ):
        try:
            interpreter = Interpreter(
                model_path=MODEL_PATH,
                experimental_delegates=[
                    load_delegate(lib_path)
                ],
            )
            edgetpu_lib = lib_path
            break
        except (ValueError, OSError):
            continue

    if edgetpu_lib is None:
        raise RuntimeError(
            "Could not load Edge TPU delegate. Check that libedgetpu is installed "
            "and Coral USB is connected.\n"
            "Install: sudo apt install -y libedgetpu1-std"
        )

    interpreter.allocate_tensors()
    log.info("Loaded model with Edge TPU delegate (%s): %s", edgetpu_lib, MODEL_PATH)
    return interpreter


def load_labels() -> dict:
    labels = {}
    if os.path.exists(LABELS_PATH):
        with open(LABELS_PATH, "r") as f:
            for line in f:
                parts = line.strip().split(maxsplit=1)
                if len(parts) == 2:
                    labels[int(parts[0])] = parts[1]
    return labels


Detection = Tuple[int, int, int, int, float]  # x, y, w, h, score


def detect_persons(interpreter, frame: np.ndarray) -> List[Detection]:
    h, w = frame.shape[:2]

    # Get model input shape
    input_details = interpreter.get_input_details()
    input_shape = input_details[0]["shape"]  # e.g. [1, 300, 300, 3]
    input_h, input_w = input_shape[1], input_shape[2]

    # Prepare input
    resized = cv2.resize(frame, (input_w, input_h))
    rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)
    input_data = np.expand_dims(rgb, axis=0).astype(np.uint8)

    interpreter.set_tensor(input_details[0]["index"], input_data)
    interpreter.invoke()

    # Parse SSD MobileNet v2 outputs:
    # 0: bounding boxes [1, N, 4] (ymin, xmin, ymax, xmax) normalized 0-1
    # 1: class IDs [1, N]
    # 2: scores [1, N]
    # 3: count [1]
    output_details = interpreter.get_output_details()
    boxes = interpreter.get_tensor(output_details[0]["index"])[0]    # [N, 4]
    classes = interpreter.get_tensor(output_details[1]["index"])[0]  # [N]
    scores = interpreter.get_tensor(output_details[2]["index"])[0]   # [N]
    count = int(interpreter.get_tensor(output_details[3]["index"])[0])

    results = []
    for i in range(count):
        if scores[i] < MIN_SCORE:
            continue
        if int(classes[i]) != PERSON_CLASS_ID:
            continue

        ymin, xmin, ymax, xmax = boxes[i]
        x = int(xmin * w)
        y = int(ymin * h)
        bw = int((xmax - xmin) * w)
        bh = int((ymax - ymin) * h)
        results.append((x, y, bw, bh, float(scores[i])))

    return results

# ---------------------------------------------------------------------------
# Tracking controller
# ---------------------------------------------------------------------------

class TrackingController:
    def __init__(self):
        self.pan = TRACK_HOME_PAN
        self.tilt = TRACK_HOME_TILT
        self.last_detection_time = time.monotonic()
        self.last_send_time = 0.0
        self._session = requests.Session()

    def update(self, detections: List[Detection], frame_w: int, frame_h: int):
        now = time.monotonic()

        if detections:
            self.last_detection_time = now
            # Pick largest person by bounding box area
            best = max(detections, key=lambda d: d[2] * d[3])
            x, y, w, h, _ = best
            cx = x + w / 2
            cy = y + h / 2

            err_x = (cx - frame_w / 2) / (frame_w / 2)  # normalized [-1, 1]
            err_y = (cy - frame_h / 2) / (frame_h / 2)

            if TRACK_INVERT_PAN:
                err_x = -err_x
            if TRACK_INVERT_TILT:
                err_y = -err_y

            if abs(err_x) > TRACK_DEADZONE:
                self.pan += TRACK_SPEED_PAN * err_x
            if abs(err_y) > TRACK_DEADZONE:
                self.tilt += TRACK_SPEED_TILT * err_y

            self.pan = max(0.0, min(180.0, self.pan))
            self.tilt = max(0.0, min(180.0, self.tilt))
        else:
            elapsed = now - self.last_detection_time
            if TRACK_RETURN_HOME and elapsed > TRACK_LOST_TIMEOUT:
                # Gradually return to home
                self.pan += (TRACK_HOME_PAN - self.pan) * 0.05
                self.tilt += (TRACK_HOME_TILT - self.tilt) * 0.05

        self._send_servos()

    def _send_servos(self):
        now = time.monotonic()
        if now - self.last_send_time < 0.05:  # rate limit 20Hz
            return
        self.last_send_time = now

        for ch, angle in ((TRACK_PAN_CH, self.pan), (TRACK_TILT_CH, self.tilt)):
            try:
                self._session.post(
                    TRACK_SERVO_API,
                    json={"channel": ch, "angle": round(angle, 1)},
                    timeout=0.5,
                )
            except Exception:
                pass  # fire-and-forget; servo API may be briefly unavailable

# ---------------------------------------------------------------------------
# Frame producer (background thread)
# ---------------------------------------------------------------------------

class FrameBuffer:
    def __init__(self):
        self.frame: Optional[bytes] = None
        self.lock = threading.Lock()
        self.event = threading.Event()

    def put(self, jpg: bytes):
        with self.lock:
            self.frame = jpg
        self.event.set()

    def get(self) -> Optional[bytes]:
        self.event.wait(timeout=2.0)
        self.event.clear()
        with self.lock:
            return self.frame


frame_buffer = FrameBuffer()


def open_capture(url: str) -> cv2.VideoCapture:
    cap = cv2.VideoCapture(url)
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    return cap


def detection_loop():
    log.info("Initializing Coral Edge TPU...")
    interpreter = load_interpreter()
    labels = load_labels()
    tracker = TrackingController() if TRACK_ENABLED else None

    log.info("Connecting to camera stream: %s", STREAM_URL)
    cap = open_capture(STREAM_URL)
    frame_idx = 0
    last_detections: List[Detection] = []

    while True:
        ok, frame = cap.read()
        if not ok:
            cap.release()
            time.sleep(0.5)
            log.warning("Lost camera stream, reconnecting...")
            cap = open_capture(STREAM_URL)
            continue

        frame_idx += 1

        # Run detection every N frames
        if frame_idx % DETECT_EVERY_N == 0:
            try:
                last_detections = detect_persons(interpreter, frame)
            except Exception as e:
                log.error("Detection error: %s", e)
                last_detections = []

        # Update tracking
        if tracker and frame_idx % DETECT_EVERY_N == 0:
            h, w = frame.shape[:2]
            tracker.update(last_detections, w, h)

        # Draw bounding boxes
        primary = max(last_detections, key=lambda d: d[2] * d[3]) if last_detections else None
        for det in last_detections:
            x, y, w, h, score = det
            is_primary = det is primary
            color = (220, 200, 32) if is_primary else (32, 220, 90)  # cyan for tracked, green for others
            cv2.rectangle(frame, (x, y), (x + w, y + h), color, 2)
            label = f"person {score:.0%}"
            cv2.putText(frame, label, (x, y - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1)

        # Overlay tracking info
        if tracker:
            info = f"pan:{tracker.pan:.0f} tilt:{tracker.tilt:.0f} det:{len(last_detections)}"
            cv2.putText(frame, info, (10, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)

        # Encode and push to buffer
        ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
        if ok:
            frame_buffer.put(buf.tobytes())


# ---------------------------------------------------------------------------
# Flask routes
# ---------------------------------------------------------------------------

def generate_frames():
    while True:
        jpg = frame_buffer.get()
        if jpg is None:
            continue
        yield (
            b"--frame\r\n"
            b"Content-Type: image/jpeg\r\n"
            b"Content-Length: " + str(len(jpg)).encode("ascii") + b"\r\n\r\n" + jpg + b"\r\n"
        )


@app.get("/stream.mjpg")
def stream():
    return Response(generate_frames(), mimetype="multipart/x-mixed-replace; boundary=frame")


@app.get("/health")
def health():
    return {"ok": True}


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    worker = threading.Thread(target=detection_loop, daemon=True)
    worker.start()
    log.info("Starting MJPEG stream on %s:%d", HOST, PORT)
    app.run(host=HOST, port=PORT, threaded=True)
