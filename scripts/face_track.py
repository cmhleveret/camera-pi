import os
import time
from typing import Generator, Tuple

import cv2
from flask import Flask, Response

DEFAULT_STREAM = "http://127.0.0.1:8080/stream.mjpg"

STREAM_URL = os.environ.get("FACETRACK_STREAM_URL", DEFAULT_STREAM)
HOST = os.environ.get("FACETRACK_HOST", "0.0.0.0")
PORT = int(os.environ.get("FACETRACK_PORT", "8081"))

DETECT_EVERY_N = int(os.environ.get("FACETRACK_DETECT_EVERY_N", "3"))
MIN_SIZE = int(os.environ.get("FACETRACK_MIN_SIZE", "40"))
CASCADE_PATH = os.environ.get("FACETRACK_CASCADE_PATH", "")

app = Flask(__name__)


def open_capture(url: str) -> cv2.VideoCapture:
    cap = cv2.VideoCapture(url)
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    return cap


def detect_faces(gray, cascade) -> Tuple[Tuple[int, int, int, int], ...]:
    faces = cascade.detectMultiScale(
        gray,
        scaleFactor=1.1,
        minNeighbors=5,
        minSize=(MIN_SIZE, MIN_SIZE),
    )
    return tuple((int(x), int(y), int(w), int(h)) for (x, y, w, h) in faces)


def generate_frames() -> Generator[bytes, None, None]:
    cascade_path = CASCADE_PATH
    if not cascade_path:
        if hasattr(cv2, "data") and hasattr(cv2.data, "haarcascades"):
            cascade_path = os.path.join(
                cv2.data.haarcascades, "haarcascade_frontalface_default.xml"
            )
        else:
            candidates = (
                "/usr/share/opencv/haarcascades/haarcascade_frontalface_default.xml",
                "/usr/share/opencv4/haarcascades/haarcascade_frontalface_default.xml",
                "/usr/local/share/opencv4/haarcascades/haarcascade_frontalface_default.xml",
            )
            for path in candidates:
                if os.path.exists(path):
                    cascade_path = path
                    break
    if not cascade_path or not os.path.exists(cascade_path):
        raise RuntimeError(
            "Could not find Haar cascade. Set FACETRACK_CASCADE_PATH to the "
            "haarcascade_frontalface_default.xml path."
        )

    cascade = cv2.CascadeClassifier(cascade_path)
    cap = open_capture(STREAM_URL)
    last_faces: Tuple[Tuple[int, int, int, int], ...] = tuple()
    frame_idx = 0

    while True:
        ok, frame = cap.read()
        if not ok:
            cap.release()
            time.sleep(0.2)
            cap = open_capture(STREAM_URL)
            continue

        frame_idx += 1
        if frame_idx % DETECT_EVERY_N == 0:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            last_faces = detect_faces(gray, cascade)

        for (x, y, w, h) in last_faces:
            cv2.rectangle(frame, (x, y), (x + w, y + h), (32, 220, 90), 2)

        ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
        if not ok:
            continue

        jpg = buf.tobytes()
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


if __name__ == "__main__":
    app.run(host=HOST, port=PORT, threaded=True)
