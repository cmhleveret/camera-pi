import io
from flask import Flask, Response
from threading import Condition

from picamera2 import Picamera2
from picamera2.encoders import JpegEncoder
from picamera2.outputs import FileOutput

app = Flask(__name__)

class StreamingOutput(io.BufferedIOBase):
    def __init__(self):
        self.frame = None
        self.condition = Condition()

    def write(self, buf):
        with self.condition:
            self.frame = buf
            self.condition.notify_all()

output = StreamingOutput()

picam2 = Picamera2()
picam2.configure(picam2.create_video_configuration(main={"size": (1280, 720)}))
picam2.start_recording(JpegEncoder(), FileOutput(output))

def generate():
    while True:
        with output.condition:
            output.condition.wait()
            frame = output.frame
        yield (b"--FRAME\r\n"
               b"Content-Type: image/jpeg\r\n"
               b"Content-Length: " + str(len(frame)).encode() + b"\r\n\r\n" +
               frame + b"\r\n")

@app.get("/stream.mjpg")
def stream():
    return Response(generate(), mimetype="multipart/x-mixed-replace; boundary=FRAME")

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080, threaded=True)
