import os
import time
import threading
import logging
import json
import urllib.request
from queue import Queue, Empty
from typing import List, Tuple, Optional

import cv2
import numpy as np
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
# Coral TPU detection (using pycoral + tflite-runtime)
# ---------------------------------------------------------------------------

def load_interpreter():
    from pycoral.utils.edgetpu import make_interpreter, list_edge_tpus

    tpus = list_edge_tpus()
    if not tpus:
        raise RuntimeError(
            "No Google Coral Edge TPU detected. Check USB connection and libedgetpu installation."
        )
    log.info("Found %d Edge TPU(s): %s", len(tpus), tpus)

    if not os.path.exists(MODEL_PATH):
        raise RuntimeError(
            f"Model not found at {MODEL_PATH}. Run scripts/models/download_model.sh first."
        )

    interpreter = make_interpreter(MODEL_PATH)
    interpreter.allocate_tensors()
    log.info("Loaded model: %s", MODEL_PATH)
    return interpreter


def load_labels() -> dict:
    labels = {}
    if os.path.exists(LABELS_PATH):
        with open(LABELS_PATH, "r") as f:
            for i, line in enumerate(f):
                parts = line.strip().split(maxsplit=1)
                if len(parts) == 2:
                    try:
                        labels[int(parts[0])] = parts[1]
                    except ValueError:
                        labels[i] = line.strip()
                elif len(parts) == 1 and parts[0]:
                    labels[i] = parts[0]
    return labels


Detection = Tuple[int, int, int, int, float]  # x, y, w, h, score



# ---------------------------------------------------------------------------
# Tracking controller
# ---------------------------------------------------------------------------

class ServoSender:
    """Background thread that sends servo commands via HTTP.
    Only keeps the latest command per channel — stale commands are dropped."""

    def __init__(self):
        self._latest = {}  # channel -> angle (always overwritten)
        self._lock = threading.Lock()
        self._event = threading.Event()
        t = threading.Thread(target=self._run, daemon=True)
        t.start()

    def send(self, channel: int, angle: float):
        with self._lock:
            self._latest[channel] = round(angle, 1)
        self._event.set()

    def _run(self):
        while True:
            self._event.wait(timeout=1.0)
            self._event.clear()
            with self._lock:
                commands = dict(self._latest)
            for ch, angle in commands.items():
                try:
                    data = json.dumps({"channel": ch, "angle": angle}).encode()
                    req = urllib.request.Request(
                        TRACK_SERVO_API,
                        data=data,
                        headers={"Content-Type": "application/json"},
                        method="POST",
                    )
                    urllib.request.urlopen(req, timeout=0.3)
                except Exception:
                    pass


class TrackingController:
    def __init__(self):
        self.pan = TRACK_HOME_PAN
        self.tilt = TRACK_HOME_TILT
        self.last_detection_time = time.monotonic()
        self.last_send_time = 0.0
        self._sender = ServoSender()

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
                self.pan += (TRACK_HOME_PAN - self.pan) * 0.05
                self.tilt += (TRACK_HOME_TILT - self.tilt) * 0.05

        # Non-blocking: just updates the latest target, sender thread picks it up
        now = time.monotonic()
        if now - self.last_send_time >= 0.04:  # 25Hz
            self.last_send_time = now
            self._sender.send(TRACK_PAN_CH, self.pan)
            self._sender.send(TRACK_TILT_CH, self.tilt)

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


# ---------------------------------------------------------------------------
# Camera grab thread — always keeps only the LATEST frame
# ---------------------------------------------------------------------------

class CameraGrabber:
    """Dedicated thread that continuously reads from the MJPEG stream,
    discarding old frames so the detection loop always gets the newest one."""

    def __init__(self, url: str):
        self._url = url
        self._frame: Optional[np.ndarray] = None
        self._lock = threading.Lock()
        self._running = True

    def start(self):
        t = threading.Thread(target=self._grab_loop, daemon=True)
        t.start()

    def _grab_loop(self):
        cap = cv2.VideoCapture(self._url, cv2.CAP_FFMPEG)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

        while self._running:
            ok = cap.grab()  # grab without decoding — fast
            if not ok:
                cap.release()
                time.sleep(0.3)
                log.warning("Lost camera stream, reconnecting...")
                cap = cv2.VideoCapture(self._url, cv2.CAP_FFMPEG)
                cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                continue

            ok, frame = cap.retrieve()  # decode the grabbed frame
            if ok:
                with self._lock:
                    self._frame = frame

    def get_frame(self) -> Optional[np.ndarray]:
        with self._lock:
            return self._frame


# Cache pycoral imports at module level after first call
_pycoral_common = None
_pycoral_detect = None
_input_size = None


def detection_loop():
    global _pycoral_common, _pycoral_detect, _input_size

    log.info("Initializing Coral Edge TPU...")
    interpreter = load_interpreter()
    labels = load_labels()
    tracker = TrackingController() if TRACK_ENABLED else None

    # Cache pycoral imports and input size (avoid per-frame overhead)
    from pycoral.adapters import common, detect
    _pycoral_common = common
    _pycoral_detect = detect
    _input_size = common.input_size(interpreter)

    log.info("Connecting to camera stream: %s", STREAM_URL)
    grabber = CameraGrabber(STREAM_URL)
    grabber.start()

    # Wait for first frame
    while grabber.get_frame() is None:
        time.sleep(0.1)
    log.info("Camera stream connected")

    frame_idx = 0
    last_detections: List[Detection] = []
    encode_params = [int(cv2.IMWRITE_JPEG_QUALITY), 70]

    while True:
        # Always get the LATEST frame — no buffering lag
        frame = grabber.get_frame()
        if frame is None:
            time.sleep(0.01)
            continue

        frame_idx += 1

        # Run detection every N frames
        if frame_idx % DETECT_EVERY_N == 0:
            try:
                last_detections = _detect_fast(interpreter, frame)
            except Exception as e:
                log.error("Detection error: %s", e)
                last_detections = []

            # Update tracking on detection frames only
            if tracker:
                h, w = frame.shape[:2]
                tracker.update(last_detections, w, h)

        # Draw bounding boxes
        annotated = frame.copy()
        primary = max(last_detections, key=lambda d: d[2] * d[3]) if last_detections else None
        for det in last_detections:
            x, y, w, h, score = det
            is_primary = det is primary
            color = (220, 200, 32) if is_primary else (32, 220, 90)
            cv2.rectangle(annotated, (x, y), (x + w, y + h), color, 2)
            label = f"person {score:.0%}"
            cv2.putText(annotated, label, (x, y - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1)

        if tracker:
            info = f"pan:{tracker.pan:.0f} tilt:{tracker.tilt:.0f} det:{len(last_detections)}"
            cv2.putText(annotated, info, (10, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)

        ok, buf = cv2.imencode(".jpg", annotated, encode_params)
        if ok:
            frame_buffer.put(buf.tobytes())


def _detect_fast(interpreter, frame: np.ndarray) -> List[Detection]:
    """Optimized detection using cached imports and pre-computed input size."""
    h, w = frame.shape[:2]
    resized = cv2.resize(frame, _input_size, interpolation=cv2.INTER_NEAREST)
    rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)
    _pycoral_common.set_input(interpreter, rgb)
    interpreter.invoke()

    objs = _pycoral_detect.get_objects(interpreter, score_threshold=MIN_SCORE)
    scale_x = w / _input_size[0]
    scale_y = h / _input_size[1]

    results = []
    for obj in objs:
        if obj.id != PERSON_CLASS_ID:
            continue
        bbox = obj.bbox
        x = int(bbox.xmin * scale_x)
        y = int(bbox.ymin * scale_y)
        bw = int((bbox.xmax - bbox.xmin) * scale_x)
        bh = int((bbox.ymax - bbox.ymin) * scale_y)
        results.append((x, y, bw, bh, obj.score))

    return results


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
