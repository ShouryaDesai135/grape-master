"""
convert_to_tfjs.py — Keras Model → TensorFlow.js Converter
════════════════════════════════════════════════════════════

PURPOSE:
    Converts the trained grape_master_cnn.h5 model into TensorFlow.js
    format so that Node.js backend (visionEngine.js) can load and run
    inference directly in JavaScript without a Python server.

HOW IT WORKS:
    The tensorflowjs_converter CLI reads our .h5 model and outputs:
    - model.json     : Architecture definition
    - group1-shard1ofN.bin : Weight binary files

    These files are placed in output/tfjs_model/ which the backend
    visionEngine.js loads at startup via tf.loadLayersModel().

USAGE:
    python convert_to_tfjs.py

PREREQUISITES:
    - grape_master_cnn.h5 must exist (run train_model.py first)
    - tensorflowjs must be installed (in requirements.txt)
"""

import os
import sys
import subprocess
from pathlib import Path

# ─────────────────────────────────────────────────────────────────
# PATHS — Must match visionEngine.js MODEL_DIR constant exactly
# ─────────────────────────────────────────────────────────────────
BASE_DIR      = Path(__file__).parent.resolve()
MODEL_H5      = BASE_DIR / 'grape_master_cnn.h5'

# This path MUST match what visionEngine.js expects:
# const MODEL_DIR = path.join(__dirname, '../../model/output/tfjs_model')
OUTPUT_DIR    = BASE_DIR / 'output' / 'tfjs_model'


def convert():
    sys.stdout.reconfigure(encoding='utf-8')
    # 1. Check the .h5 model exists
    if not MODEL_H5.exists():
        print(f"❌ Model not found at: {MODEL_H5}")
        print("   Train the model first: python train_model.py")
        sys.exit(1)

    # 2. Create output directory
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print("=" * 60)
    print("  Grape Master — Keras → TF.js Conversion")
    print("=" * 60)
    print(f"\n  Input  : {MODEL_H5}")
    print(f"  Output : {OUTPUT_DIR}\n")

    # 3. Locate tensorflowjs_converter
    # pip installs it to AppData\Roaming\Python\Python310\Scripts on Windows
    # which may not be on PATH. We search for it explicitly as a fallback.
    import shutil
    converter_cmd = shutil.which("tensorflowjs_converter")
    if not converter_cmd:
        # Try the user Scripts folder directly
        scripts_dir = Path(sys.executable).parent / "Scripts"
        candidate = scripts_dir / "tensorflowjs_converter.exe"
        if candidate.exists():
            converter_cmd = str(candidate)
        else:
            # Last resort: AppData user scripts
            appdata = Path.home() / "AppData" / "Roaming" / "Python" / "Python310" / "Scripts"
            candidate2 = appdata / "tensorflowjs_converter.exe"
            if candidate2.exists():
                converter_cmd = str(candidate2)

    # Use Python API directly with optional module mocks to avoid TF hub / decision forest issues
    import unittest.mock
    sys.modules['tensorflow_decision_forests'] = unittest.mock.MagicMock()
    sys.modules['tensorflow_hub'] = unittest.mock.MagicMock()

    try:
        import tensorflow as tf
        import tensorflowjs as tfjs

        print("  Loading Keras model...")
        model = tf.keras.models.load_model(str(MODEL_H5))
        print("  Converting model to TF.js format...")
        tfjs.converters.save_keras_model(model, str(OUTPUT_DIR))

        print("\n✅ Conversion successful! Files generated:")
        for f in sorted(OUTPUT_DIR.iterdir()):
            size_kb = f.stat().st_size / 1024
            print(f"   {f.name:<40} {size_kb:.1f} KB")

        print(f"\n🚀 Next step: Restart your Node.js backend server.")
        print(f"   The server will auto-load the model from:")
        print(f"   {OUTPUT_DIR}")
    except Exception as e:
        print(f"❌ Python conversion failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    convert()
