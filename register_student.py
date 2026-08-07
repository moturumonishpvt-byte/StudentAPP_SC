import os
import sys
import json
import cv2
import numpy as np
import tensorflow as tf
import urllib.request

# Supabase Credentials
SUPABASE_URL = "https://gduxlotlifugsvdcopep.supabase.co"
SUPABASE_ANON_KEY = "sb_publishable_LndCahcsg_FSYeoSmdgoAw_uuz2OxLT"

def extract_cropped_face(img, x, y, w, h, margin=0.25):
    img_h, img_w, _ = img.shape
    margin_w = int(w * margin)
    margin_h = int(h * margin)
    
    left = max(0, x - margin_w)
    top = max(0, y - margin_h)
    right = min(img_w, x + w + margin_w)
    bottom = min(img_h, y + h + margin_h)
    
    cropped = img[top:bottom, left:right]
    resized = cv2.resize(cropped, (112, 112))
    
    # Apply CLAHE (Contrast Limited Adaptive Histogram Equalization) for lighting invariance
    lab = cv2.cvtColor(resized, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    cl = clahe.apply(l)
    limg = cv2.merge((cl, a, b))
    enhanced = cv2.cvtColor(limg, cv2.COLOR_LAB2BGR)
    return enhanced

def detect_and_crop_face(image_path):
    img = cv2.imread(image_path)
    if img is None:
        raise ValueError(f"Could not load image from path: {image_path}")
        
    h, w, _ = img.shape
    
    # Haar Cascade detector
    cascade_path = cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
    face_cascade = cv2.CascadeClassifier(cascade_path)
    if face_cascade.empty():
        raise RuntimeError("Could not load Haar Cascade XML file.")
        
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    faces = face_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(30, 30))
    
    if len(faces) == 0:
        print("⚠️ No face detected. Using the center square region as fallback.")
        size = min(w, h)
        cx, cy = w // 2, h // 2
        cropped = img[cy - size // 2:cy + size // 2, cx - size // 2:cx + size // 2]
        return cv2.resize(cropped, (112, 112))
        
    faces = sorted(faces, key=lambda f: f[2] * f[3], reverse=True)
    x, y, fw, fh = faces[0]
    print(f"✅ Face detected: x={x}, y={y}, w={fw}, h={fh}")
    return extract_cropped_face(img, x, y, fw, fh, 0.20)

def get_embedding(interpreter, face_img):
    rgb = cv2.cvtColor(face_img, cv2.COLOR_BGR2RGB)
    
    # Preprocessing: normalize to [-1, 1]
    input_data = (rgb.astype(np.float32) - 127.5) / 128.0
    input_data = np.expand_dims(input_data, axis=0)
    
    input_details = interpreter.get_input_details()
    output_details = interpreter.get_output_details()
    
    interpreter.set_tensor(input_details[0]['index'], input_data)
    interpreter.invoke()
    
    raw_embedding = interpreter.get_tensor(output_details[0]['index'])[0]
    
    # L2 normalize
    norm = np.linalg.norm(raw_embedding)
    if norm > 0:
        normalized = raw_embedding / norm
    else:
        normalized = raw_embedding
        
    # Slice to first 128 dimensions as the Android module does
    return normalized[:128].tolist()

def upload_to_supabase(student_uid, roll_number, name, course, branch, semester, section, embedding):
    url = f"{SUPABASE_URL}/rest/v1/students"
    
    headers = {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates"  # Upsert matching student_uid
    }
    
    payload = {
        "student_uid": str(student_uid),
        "roll_number": str(roll_number),
        "name": name,
        "course": course,
        "branch": branch,
        "semester": int(semester) if semester is not None else None,
        "section": section,
        "face_embedding": embedding
    }
    
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode('utf-8'),
        headers=headers,
        method='POST'
    )
    
    try:
        with urllib.request.urlopen(req) as response:
            status = response.getcode()
            if status in [200, 201]:
                print(f"🎉 SUCCESS! Student '{name}' (ID: {student_uid}, Roll: {roll_number}) registered in Supabase.")
            else:
                print(f"⚠️ Response returned status code: {status}")
    except Exception as e:
        print(f"❌ Error uploading to Supabase: {e}")
        if hasattr(e, 'read'):
            print(f"Detail: {e.read().decode('utf-8')}")

def main():
    print("==================================================")
    print("      STUDENT REGISTRATION SYSTEM (SUPABASE)      ")
    print("==================================================")
    
    # Prompt interactively if command line arguments are omitted
    if len(sys.argv) < 2:
        image_path = input("Enter Image File Path (e.g. nitish.jpg): ").strip()
        student_id = input("Enter Student UID (e.g. 21006): ").strip()
        roll_number = input("Enter Roll Number (e.g. 23L31A4465): ").strip()
        student_name = input("Enter Student Name: ").strip()
        course = input("Enter Course [Default: BTech]: ").strip() or "BTech"
        branch = input("Enter Branch [Default: CSE]: ").strip() or "CSE"
        semester_str = input("Enter Semester [Default: 1]: ").strip() or "1"
        section = input("Enter Section [Default: A]: ").strip() or "A"
    else:
        if len(sys.argv) < 4:
            print("Usage: python register_student.py <image_path> <student_id> <student_name> [<roll_number> <course> <branch> <semester> <section>]")
            sys.exit(1)
        image_path = sys.argv[1]
        student_id = sys.argv[2]
        student_name = sys.argv[3]
        roll_number = sys.argv[4] if len(sys.argv) > 4 else student_id
        course = sys.argv[5] if len(sys.argv) > 5 else "BTech"
        branch = sys.argv[6] if len(sys.argv) > 6 else "CSE"
        semester_str = sys.argv[7] if len(sys.argv) > 7 else "1"
        section = sys.argv[8] if len(sys.argv) > 8 else "A"
        
    try:
        semester = int(semester_str)
    except ValueError:
        print("Error: Semester must be a valid number.")
        sys.exit(1)
    
    if not os.path.exists(image_path):
        print(f"Error: Image path not found: {image_path}")
        sys.exit(1)
        
    model_path = os.path.join("android", "app", "src", "main", "assets", "models", "mobilefacenet.tflite")
    if not os.path.exists(model_path):
        # Try search relative to script
        model_path = os.path.join(os.path.dirname(__file__), "android", "app", "src", "main", "assets", "models", "mobilefacenet.tflite")
        
    if not os.path.exists(model_path):
        print(f"Error: TFLite model not found at: {model_path}")
        sys.exit(1)
        
    print(f"Loading TFLite model from: {model_path}...")
    interpreter = tf.lite.Interpreter(model_path=model_path)
    interpreter.allocate_tensors()
    
    print("Processing face image...")
    face_img = detect_and_crop_face(image_path)
    
    print("Extracting 128-dimensional embedding...")
    embedding = get_embedding(interpreter, face_img)
    
    print("Uploading to Supabase...")
    upload_to_supabase(student_id, roll_number, student_name, course, branch, semester, section, embedding)

if __name__ == '__main__':
    main()
