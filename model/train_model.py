"""
train_model.py — Custom CNN Training Script
════════════════════════════════════════════

PURPOSE:
    Trains a custom Convolutional Neural Network from scratch (NO pretrained
    weights, NO transfer learning) to classify grape leaf diseases into 7 classes:
    (healthy, black_rot, esca, leaf_blight, downy_mildew, powdery_mildew, bacterial_rot).
    This is the core ML model powering Grape Master's image diagnosis feature.

ARCHITECTURE (GrapeMaster_CNN):
    ┌─────────────────────────────────────────────────┐
    │  Input: 224×224×3 RGB image                     │
    │                                                  │
    │  Block 1: Conv(32) → BN → ReLU → Conv(32)       │
    │           → ReLU → MaxPool → Dropout(0.25)      │
    │                                                  │
    │  Block 2: Conv(64) → BN → ReLU → Conv(64)       │
    │           → ReLU → MaxPool → Dropout(0.25)      │
    │                                                  │
    │  Block 3: Conv(128) → BN → ReLU → Conv(128)     │
    │           → ReLU → MaxPool → Dropout(0.30)      │
    │                                                  │
    │  Block 4: Conv(256) → BN → ReLU → Conv(256)     │
    │           → ReLU → MaxPool → Dropout(0.30)      │
    │                                                  │
    │  Head: GlobalAvgPool → Dense(512) → BN          │
    │        → ReLU → Dropout(0.5) → Softmax(N)       │
    └─────────────────────────────────────────────────┘

    Why this architecture?
    - Increasing filter depth (32→64→128→256) captures features
      from edges to complex disease patterns
    - BatchNormalization: stabilizes training, acts as regularizer
    - GlobalAveragePooling: reduces parameters vs Flatten (~10x fewer)
    - Dropout at every block: prevents overfitting on small datasets
    - No pretrained weights: satisfies PRD constraint

TRAINING STRATEGY:
    - Adam optimizer with initial LR=0.0005
    - ReduceLROnPlateau: halves LR if val_loss doesn't improve for 5 epochs
    - EarlyStopping: stops if no improvement for 12 epochs
    - ModelCheckpoint: saves only the BEST validation loss model
    - Class weights: handles class imbalance automatically

EXPECTED RESULTS (on PlantVillage + GVLiD):
    - Training accuracy: 90-95%
    - Validation accuracy: 85-92%
    - Training time: ~2-3 hours on CPU, ~25-40 min on GPU

USAGE:
    python train_model.py

OUTPUTS:
    model/grape_master_cnn.h5        ← Best model weights
    model/training_history.csv       ← Epoch-by-epoch metrics
    model/training_curves.png        ← Accuracy & loss plots
"""

import os
import sys

# ── MUST be set before importing tensorflow ────────────────────
# TF 2.16+ ships with Keras 3 by default which breaks tensorflow.keras imports.
# This flag forces TF to use the legacy tf-keras package instead.
os.environ['TF_USE_LEGACY_KERAS'] = '1'
# Suppress noisy oneDNN and deprecation warnings — keeps training output clean
os.environ['TF_ENABLE_ONEDNN_OPTS'] = '0'
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '2'   # 0=all, 1=info, 2=warnings, 3=errors only

import warnings
warnings.filterwarnings('ignore')

import numpy as np
import matplotlib
matplotlib.use('Agg')  # Non-interactive backend for saving plots
import matplotlib.pyplot as plt
import tensorflow as tf
from tensorflow.keras import regularizers
from tensorflow.keras.models import Sequential
from tensorflow.keras.layers import (
    Input, Conv2D, MaxPooling2D, GlobalAveragePooling2D,
    Dense, Dropout, BatchNormalization, Activation
)
from tensorflow.keras.preprocessing.image import ImageDataGenerator
from tensorflow.keras.callbacks import (
    ModelCheckpoint, EarlyStopping, ReduceLROnPlateau, CSVLogger
)
from sklearn.utils.class_weight import compute_class_weight
from pathlib import Path

# ─────────────────────────────────────────────────────────────────
# CONFIGURATION
# ─────────────────────────────────────────────────────────────────
IMG_SIZE      = 224          # Both width and height (pixels)
BATCH_SIZE    = 32           # Images per training step
EPOCHS        = 60           # Max epochs (EarlyStopping will cut short)
LEARNING_RATE = 0.0005       # Adam initial learning rate
L2_REG        = 0.0001       # L2 weight decay for all conv layers

BASE_DIR      = Path(__file__).parent.resolve()
DATA_DIR      = BASE_DIR.parent / 'data' / 'processed'
TRAIN_DIR     = DATA_DIR / 'train'
VAL_DIR       = DATA_DIR / 'val'

MODEL_SAVE    = BASE_DIR / 'grape_master_cnn.h5'
LOGS_CSV      = BASE_DIR / 'training_history.csv'
CURVES_PNG    = BASE_DIR / 'training_curves.png'


# ─────────────────────────────────────────────────────────────────
# ARCHITECTURE
# ─────────────────────────────────────────────────────────────────
def build_cnn(num_classes: int) -> tf.keras.Model:
    """
    Builds the GrapeMaster custom CNN from scratch.
    L2 regularization is applied to all Conv2D layers to reduce overfitting.
    """
    reg = regularizers.l2(L2_REG)

    model = Sequential(name="GrapeMaster_CNN", layers=[
        Input(shape=(IMG_SIZE, IMG_SIZE, 3), name="input"),

        # ── Block 1 ──────────────────────────────────────────────
        # Learns basic edges, color gradients, simple textures
        Conv2D(32, (3,3), padding='same', kernel_regularizer=reg, name='b1_c1'),
        BatchNormalization(name='b1_bn1'),
        Activation('relu', name='b1_r1'),
        Conv2D(32, (3,3), padding='same', kernel_regularizer=reg, name='b1_c2'),
        BatchNormalization(name='b1_bn2'),
        Activation('relu', name='b1_r2'),
        MaxPooling2D((2,2), name='b1_pool'),       # 224→112
        Dropout(0.25, name='b1_drop'),

        # ── Block 2 ──────────────────────────────────────────────
        # Learns intermediate patterns: spots, patches, lesion shapes
        Conv2D(64, (3,3), padding='same', kernel_regularizer=reg, name='b2_c1'),
        BatchNormalization(name='b2_bn1'),
        Activation('relu', name='b2_r1'),
        Conv2D(64, (3,3), padding='same', kernel_regularizer=reg, name='b2_c2'),
        BatchNormalization(name='b2_bn2'),
        Activation('relu', name='b2_r2'),
        MaxPooling2D((2,2), name='b2_pool'),       # 112→56
        Dropout(0.25, name='b2_drop'),

        # ── Block 3 ──────────────────────────────────────────────
        # Learns complex disease-specific patterns: powdery coating, tiger stripes
        Conv2D(128, (3,3), padding='same', kernel_regularizer=reg, name='b3_c1'),
        BatchNormalization(name='b3_bn1'),
        Activation('relu', name='b3_r1'),
        Conv2D(128, (3,3), padding='same', kernel_regularizer=reg, name='b3_c2'),
        BatchNormalization(name='b3_bn2'),
        Activation('relu', name='b3_r2'),
        MaxPooling2D((2,2), name='b3_pool'),       # 56→28
        Dropout(0.30, name='b3_drop'),

        # ── Block 4 ──────────────────────────────────────────────
        # Learns high-level discriminative features between diseases
        Conv2D(256, (3,3), padding='same', kernel_regularizer=reg, name='b4_c1'),
        BatchNormalization(name='b4_bn1'),
        Activation('relu', name='b4_r1'),
        Conv2D(256, (3,3), padding='same', kernel_regularizer=reg, name='b4_c2'),
        BatchNormalization(name='b4_bn2'),
        Activation('relu', name='b4_r2'),
        MaxPooling2D((2,2), name='b4_pool'),       # 28→14
        Dropout(0.30, name='b4_drop'),

        # ── Classification Head ───────────────────────────────────
        # GlobalAveragePooling: takes spatial average → 256-dim vector
        GlobalAveragePooling2D(name='gap'),
        Dense(512, kernel_regularizer=reg, name='fc_512'),
        BatchNormalization(name='fc_bn'),
        Activation('relu', name='fc_relu'),
        Dropout(0.50, name='fc_drop'),

        # Output: one probability per class, sums to 1.0
        Dense(num_classes, activation='softmax', name='output'),
    ])

    return model


# ─────────────────────────────────────────────────────────────────
# DATA GENERATORS
# ─────────────────────────────────────────────────────────────────
def create_generators():
    """
    Creates training and validation data generators.
    
    Augmentation is applied ONLY to training data:
    - Rotation (±20°): simulates photos taken at different angles
    - Horizontal flip: real leaves can be oriented either way
    - Brightness (±20%): simulates different lighting conditions
    - Zoom (±15%): simulates different distances from leaf
    - Width/Height shift (±10%): simulates off-center photos
    - Shear (±10%): handles slight perspective distortion
    
    All images are normalized to [0, 1] by dividing pixel values by 255.
    """
    train_datagen = ImageDataGenerator(
        rescale=1.0 / 255.0,
        rotation_range=20,
        horizontal_flip=True,
        vertical_flip=False,      # Leaves don't appear upside down
        brightness_range=[0.80, 1.20],
        zoom_range=0.15,
        width_shift_range=0.10,
        height_shift_range=0.10,
        shear_range=0.10,
        fill_mode='nearest'       # Fill empty pixels after rotation
    )

    val_datagen = ImageDataGenerator(rescale=1.0 / 255.0)

    train_gen = train_datagen.flow_from_directory(
        str(TRAIN_DIR),
        target_size=(IMG_SIZE, IMG_SIZE),
        batch_size=BATCH_SIZE,
        class_mode='categorical',
        shuffle=True,
        seed=42
    )

    val_gen = val_datagen.flow_from_directory(
        str(VAL_DIR),
        target_size=(IMG_SIZE, IMG_SIZE),
        batch_size=BATCH_SIZE,
        class_mode='categorical',
        shuffle=False
    )

    return train_gen, val_gen


# ─────────────────────────────────────────────────────────────────
# CLASS WEIGHTS (for imbalanced datasets)
# ─────────────────────────────────────────────────────────────────
def get_class_weights(train_gen):
    """
    Calculates per-class weights so that rarer classes contribute
    more to the loss function. This prevents the model from being
    biased toward the majority class.
    
    Example: if 'esca' has 200 images but 'healthy' has 800,
    esca will get 4× higher weight in the loss.
    """
    labels = train_gen.classes
    unique_classes = np.unique(labels)
    weights = compute_class_weight('balanced', classes=unique_classes, y=labels)
    class_weight_dict = dict(zip(unique_classes, weights))
    print("\n⚖️  Class Weights (for imbalance correction):")
    for cls_idx, cls_name in enumerate(train_gen.class_indices.keys()):
        print(f"   {cls_name:<20} : {class_weight_dict.get(cls_idx, 1.0):.3f}")
    return class_weight_dict


# ─────────────────────────────────────────────────────────────────
# PLOT TRAINING CURVES
# ─────────────────────────────────────────────────────────────────
def save_training_curves(history):
    """
    Saves accuracy and loss curves as a PNG image.
    These are required for academic evaluation/submission.
    """
    fig, axes = plt.subplots(1, 2, figsize=(14, 5))

    epochs = range(1, len(history.history['accuracy']) + 1)

    # Accuracy
    axes[0].plot(epochs, history.history['accuracy'],     'b-o', label='Train', markersize=3)
    axes[0].plot(epochs, history.history['val_accuracy'], 'r-o', label='Val',   markersize=3)
    axes[0].set_title('Accuracy per Epoch', fontsize=13)
    axes[0].set_xlabel('Epoch')
    axes[0].set_ylabel('Accuracy')
    axes[0].legend()
    axes[0].grid(True, alpha=0.3)

    # Loss
    axes[1].plot(epochs, history.history['loss'],     'b-o', label='Train', markersize=3)
    axes[1].plot(epochs, history.history['val_loss'], 'r-o', label='Val',   markersize=3)
    axes[1].set_title('Loss per Epoch', fontsize=13)
    axes[1].set_xlabel('Epoch')
    axes[1].set_ylabel('Loss')
    axes[1].legend()
    axes[1].grid(True, alpha=0.3)

    plt.tight_layout()
    plt.savefig(str(CURVES_PNG), dpi=120)
    plt.close()
    print(f"📈 Training curves saved to: {CURVES_PNG}")


# ─────────────────────────────────────────────────────────────────
# MAIN TRAINING PIPELINE
# ─────────────────────────────────────────────────────────────────
def main():
    print("=" * 60)
    print("  Grape Master — CNN Training Pipeline")
    print("=" * 60)

    # 1. Validate data directories exist
    if not TRAIN_DIR.exists():
        print(f"❌ Training data not found at: {TRAIN_DIR}")
        print("   Please run: python data_consolidation.py first.")
        sys.exit(1)

    # 2. Create data generators
    print("\n📂 Loading datasets...")
    train_gen, val_gen = create_generators()

    num_classes = len(train_gen.class_indices)
    class_names = list(train_gen.class_indices.keys())
    print(f"\n🍇 Classes ({num_classes}): {class_names}")
    print(f"   Training samples   : {train_gen.samples}")
    print(f"   Validation samples : {val_gen.samples}")

    # 3. Compute class weights
    class_weights = get_class_weights(train_gen)

    # 4. Build model
    print("\n🧠 Building custom CNN architecture...")
    model = build_cnn(num_classes)
    model.summary()

    # 5. Compile
    optimizer = tf.keras.optimizers.Adam(learning_rate=LEARNING_RATE)
    model.compile(
        optimizer=optimizer,
        loss='categorical_crossentropy',
        metrics=['accuracy']
    )

    # 6. Callbacks
    callbacks = [
        # Save only the epoch with best validation loss
        ModelCheckpoint(
            str(MODEL_SAVE),
            monitor='val_loss',
            save_best_only=True,
            verbose=1
        ),
        # Stop training if val_loss hasn't improved for 12 epochs
        EarlyStopping(
            monitor='val_loss',
            patience=12,
            restore_best_weights=True,
            verbose=1
        ),
        # Reduce learning rate by 50% if no improvement for 5 epochs
        ReduceLROnPlateau(
            monitor='val_loss',
            factor=0.5,
            patience=5,
            min_lr=1e-7,
            verbose=1
        ),
        # Log every epoch to CSV
        CSVLogger(str(LOGS_CSV), append=False),
    ]

    # 7. Train
    print(f"\n🚂 Starting training for up to {EPOCHS} epochs...")
    print(f"   Best model will be saved to: {MODEL_SAVE}")
    print("   (EarlyStopping will halt training automatically if loss stops improving)\n")

    history = model.fit(
        train_gen,
        epochs=EPOCHS,
        validation_data=val_gen,
        callbacks=callbacks,
        class_weight=class_weights,
        verbose=1
    )

    # 8. Save training curves
    save_training_curves(history)

    # 9. Final summary
    best_val_acc  = max(history.history['val_accuracy'])
    best_val_loss = min(history.history['val_loss'])
    print("\n" + "=" * 60)
    print("  ✅ Training Complete!")
    print(f"  Best Val Accuracy : {best_val_acc * 100:.2f}%")
    print(f"  Best Val Loss     : {best_val_loss:.4f}")
    print(f"  Model saved to    : {MODEL_SAVE}")
    print("=" * 60)
    print("\n  Next step: python evaluate_model.py")


if __name__ == "__main__":
    main()
