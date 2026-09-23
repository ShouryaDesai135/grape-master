"""
train_model.py — Custom CNN Training Script
════════════════════════════════════════════

PURPOSE:
    Trains a custom Convolutional Neural Network from scratch (NO pretrained
    weights, NO transfer learning) to classify grape leaf diseases into 7 classes:
    (healthy, black_rot, esca, leaf_blight, downy_mildew, powdery_mildew, bacterial_rot).

ARCHITECTURE (GrapeMaster_CNN):
    Input: 224×224×3 RGB image

    Block 1: Conv(32) → BN → ReLU → Conv(32)
             → ReLU → MaxPool → Dropout(0.25)

    Block 2: Conv(64) → BN → ReLU → Conv(64)
             → ReLU → MaxPool → Dropout(0.25)

    Block 3: Conv(128) → BN → ReLU → Conv(128)
             → ReLU → MaxPool → Dropout(0.30)

    Block 4: Conv(256) → BN → ReLU → Conv(256)
             → ReLU → MaxPool → Dropout(0.30)

    Head: GlobalAvgPool → Dense(512) → BN
          → ReLU → Dropout(0.5) → Softmax(N)

TRAINING STRATEGY:
    - Adam optimizer with initial LR=0.0005
    - ReduceLROnPlateau: halves LR if val_loss doesn't improve for 5 epochs
    - EarlyStopping: stops if no improvement for 12 epochs
    - ModelCheckpoint: saves only the BEST validation loss model
    - Class weights: handles class imbalance automatically

COLAB DATASET STRUCTURE:
    /content/data/data/processed/
        ├── train/
        │   ├── bacterial_rot/
        │   ├── black_rot/
        │   ├── downy_mildew/
        │   ├── esca/
        │   ├── healthy/
        │   ├── leaf_blight/
        │   └── powdery_mildew/
        │
        └── val/
            ├── bacterial_rot/
            ├── black_rot/
            ├── downy_mildew/
            ├── esca/
            ├── healthy/
            ├── leaf_blight/
            └── powdery_mildew/

OUTPUTS:
    /content/drive/MyDrive/GM_CNN/grape_master_cnn.h5
    /content/drive/MyDrive/GM_CNN/training_history.csv
    /content/drive/MyDrive/GM_CNN/training_curves.png
"""

import os
import sys

# ─────────────────────────────────────────────────────────────────
# TENSORFLOW / KERAS SETTINGS
# These MUST be set before importing TensorFlow.
# ─────────────────────────────────────────────────────────────────

# TF 2.16+ ships with Keras 3 by default.
# This flag tells TensorFlow to use legacy tf-keras.
os.environ['TF_USE_LEGACY_KERAS'] = '1'

# Disable oneDNN optimizations for cleaner/reproducible output
os.environ['TF_ENABLE_ONEDNN_OPTS'] = '0'

# Suppress unnecessary TensorFlow messages
# 0 = all messages
# 1 = hide INFO
# 2 = hide INFO and WARNING
# 3 = hide INFO, WARNING and ERROR
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '2'


# ─────────────────────────────────────────────────────────────────
# IMPORTS
# ─────────────────────────────────────────────────────────────────

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
    Input,
    Conv2D,
    MaxPooling2D,
    GlobalAveragePooling2D,
    Dense,
    Dropout,
    BatchNormalization,
    Activation
)

from tensorflow.keras.preprocessing.image import ImageDataGenerator

from tensorflow.keras.callbacks import (
    ModelCheckpoint,
    EarlyStopping,
    ReduceLROnPlateau,
    CSVLogger
)

from sklearn.utils.class_weight import compute_class_weight

from pathlib import Path


# ─────────────────────────────────────────────────────────────────
# CONFIGURATION
# ─────────────────────────────────────────────────────────────────

IMG_SIZE = 224
BATCH_SIZE = 32
EPOCHS = 60

LEARNING_RATE = 0.0005
L2_REG = 0.0001


# ─────────────────────────────────────────────────────────────────
# COLAB PATHS
# ─────────────────────────────────────────────────────────────────

# Your Python script is located in /content
BASE_DIR = Path("/content")

# Your actual extracted dataset is:
# /content/data/data/processed/
DATA_DIR = Path("/content/data/data/processed")

# Training and validation folders
TRAIN_DIR = DATA_DIR / "train"
VAL_DIR = DATA_DIR / "val"


# ─────────────────────────────────────────────────────────────────
# GOOGLE DRIVE OUTPUT PATHS
# ─────────────────────────────────────────────────────────────────

# Your Google Drive folder:
# /content/drive/MyDrive/GM_CNN/

MODEL_SAVE = Path(
    "/content/drive/MyDrive/GM_CNN/grape_master_cnn.h5"
)

LOGS_CSV = Path(
    "/content/drive/MyDrive/GM_CNN/training_history.csv"
)

CURVES_PNG = Path(
    "/content/drive/MyDrive/GM_CNN/training_curves.png"
)


# Make sure the output directory exists
MODEL_SAVE.parent.mkdir(parents=True, exist_ok=True)


# ─────────────────────────────────────────────────────────────────
# ARCHITECTURE
# ─────────────────────────────────────────────────────────────────

def build_cnn(num_classes: int) -> tf.keras.Model:
    """
    Builds the GrapeMaster custom CNN from scratch.

    L2 regularization is applied to all Conv2D layers
    to reduce overfitting.
    """

    reg = regularizers.l2(L2_REG)

    model = Sequential(
        name="GrapeMaster_CNN",
        layers=[

            # ─────────────────────────────────────────────
            # INPUT
            # ─────────────────────────────────────────────

            Input(
                shape=(IMG_SIZE, IMG_SIZE, 3),
                name="input"
            ),


            # ─────────────────────────────────────────────
            # BLOCK 1
            # 224 → 112
            # ─────────────────────────────────────────────

            Conv2D(
                32,
                (3, 3),
                padding='same',
                kernel_regularizer=reg,
                name='b1_c1'
            ),

            BatchNormalization(name='b1_bn1'),

            Activation(
                'relu',
                name='b1_r1'
            ),

            Conv2D(
                32,
                (3, 3),
                padding='same',
                kernel_regularizer=reg,
                name='b1_c2'
            ),

            BatchNormalization(name='b1_bn2'),

            Activation(
                'relu',
                name='b1_r2'
            ),

            MaxPooling2D(
                (2, 2),
                name='b1_pool'
            ),

            Dropout(
                0.25,
                name='b1_drop'
            ),


            # ─────────────────────────────────────────────
            # BLOCK 2
            # 112 → 56
            # ─────────────────────────────────────────────

            Conv2D(
                64,
                (3, 3),
                padding='same',
                kernel_regularizer=reg,
                name='b2_c1'
            ),

            BatchNormalization(name='b2_bn1'),

            Activation(
                'relu',
                name='b2_r1'
            ),

            Conv2D(
                64,
                (3, 3),
                padding='same',
                kernel_regularizer=reg,
                name='b2_c2'
            ),

            BatchNormalization(name='b2_bn2'),

            Activation(
                'relu',
                name='b2_r2'
            ),

            MaxPooling2D(
                (2, 2),
                name='b2_pool'
            ),

            Dropout(
                0.25,
                name='b2_drop'
            ),


            # ─────────────────────────────────────────────
            # BLOCK 3
            # 56 → 28
            # ─────────────────────────────────────────────

            Conv2D(
                128,
                (3, 3),
                padding='same',
                kernel_regularizer=reg,
                name='b3_c1'
            ),

            BatchNormalization(name='b3_bn1'),

            Activation(
                'relu',
                name='b3_r1'
            ),

            Conv2D(
                128,
                (3, 3),
                padding='same',
                kernel_regularizer=reg,
                name='b3_c2'
            ),

            BatchNormalization(name='b3_bn2'),

            Activation(
                'relu',
                name='b3_r2'
            ),

            MaxPooling2D(
                (2, 2),
                name='b3_pool'
            ),

            Dropout(
                0.30,
                name='b3_drop'
            ),


            # ─────────────────────────────────────────────
            # BLOCK 4
            # 28 → 14
            # ─────────────────────────────────────────────

            Conv2D(
                256,
                (3, 3),
                padding='same',
                kernel_regularizer=reg,
                name='b4_c1'
            ),

            BatchNormalization(name='b4_bn1'),

            Activation(
                'relu',
                name='b4_r1'
            ),

            Conv2D(
                256,
                (3, 3),
                padding='same',
                kernel_regularizer=reg,
                name='b4_c2'
            ),

            BatchNormalization(name='b4_bn2'),

            Activation(
                'relu',
                name='b4_r2'
            ),

            MaxPooling2D(
                (2, 2),
                name='b4_pool'
            ),

            Dropout(
                0.30,
                name='b4_drop'
            ),


            # ─────────────────────────────────────────────
            # CLASSIFICATION HEAD
            # ─────────────────────────────────────────────

            GlobalAveragePooling2D(
                name='gap'
            ),

            Dense(
                512,
                kernel_regularizer=reg,
                name='fc_512'
            ),

            BatchNormalization(
                name='fc_bn'
            ),

            Activation(
                'relu',
                name='fc_relu'
            ),

            Dropout(
                0.50,
                name='fc_drop'
            ),


            # ─────────────────────────────────────────────
            # OUTPUT
            # ─────────────────────────────────────────────

            Dense(
                num_classes,
                activation='softmax',
                name='output'
            )
        ]
    )

    return model


# ─────────────────────────────────────────────────────────────────
# DATA GENERATORS
# ─────────────────────────────────────────────────────────────────

def create_generators():
    """
    Creates training and validation data generators.

    Training augmentation:
        - Rotation ±20°
        - Horizontal flip
        - Brightness ±20%
        - Zoom ±15%
        - Width shift ±10%
        - Height shift ±10%
        - Shear ±10%

    Validation data:
        - Only rescaling

    All images are normalized to [0, 1].
    """

    # ─────────────────────────────────────────────
    # TRAINING AUGMENTATION
    # ─────────────────────────────────────────────

    train_datagen = ImageDataGenerator(

        # Normalize pixels from [0,255] to [0,1]
        rescale=1.0 / 255.0,

        # Random rotation
        rotation_range=20,

        # Random horizontal flip
        horizontal_flip=True,

        # Do not flip vertically
        vertical_flip=False,

        # Random brightness
        brightness_range=[0.80, 1.20],

        # Random zoom
        zoom_range=0.15,

        # Horizontal movement
        width_shift_range=0.10,

        # Vertical movement
        height_shift_range=0.10,

        # Slight perspective/shear variation
        shear_range=0.10,

        # Fill pixels created by transformations
        fill_mode='nearest'
    )


    # ─────────────────────────────────────────────
    # VALIDATION GENERATOR
    # No augmentation
    # ─────────────────────────────────────────────

    val_datagen = ImageDataGenerator(
        rescale=1.0 / 255.0
    )


    # ─────────────────────────────────────────────
    # TRAINING GENERATOR
    # ─────────────────────────────────────────────

    train_gen = train_datagen.flow_from_directory(

        str(TRAIN_DIR),

        target_size=(
            IMG_SIZE,
            IMG_SIZE
        ),

        batch_size=BATCH_SIZE,

        class_mode='categorical',

        shuffle=True,

        seed=42
    )


    # ─────────────────────────────────────────────
    # VALIDATION GENERATOR
    # ─────────────────────────────────────────────

    val_gen = val_datagen.flow_from_directory(

        str(VAL_DIR),

        target_size=(
            IMG_SIZE,
            IMG_SIZE
        ),

        batch_size=BATCH_SIZE,

        class_mode='categorical',

        shuffle=False
    )


    return train_gen, val_gen


# ─────────────────────────────────────────────────────────────────
# CLASS WEIGHTS
# ─────────────────────────────────────────────────────────────────

def get_class_weights(train_gen):
    """
    Calculates class weights for imbalanced datasets.

    Classes with fewer images receive a larger weight.
    """

    labels = train_gen.classes

    unique_classes = np.unique(labels)

    weights = compute_class_weight(
        class_weight='balanced',
        classes=unique_classes,
        y=labels
    )

    class_weight_dict = dict(
        zip(unique_classes, weights)
    )

    print(
        "\n⚖️  Class Weights "
        "(for imbalance correction):"
    )

    for cls_idx, cls_name in enumerate(
        train_gen.class_indices.keys()
    ):

        print(
            f"   {cls_name:<20} : "
            f"{class_weight_dict.get(cls_idx, 1.0):.3f}"
        )

    return class_weight_dict


# ─────────────────────────────────────────────────────────────────
# SAVE TRAINING CURVES
# ─────────────────────────────────────────────────────────────────

def save_training_curves(history):
    """
    Saves accuracy and loss curves as a PNG image.
    """

    fig, axes = plt.subplots(
        1,
        2,
        figsize=(14, 5)
    )

    epochs = range(
        1,
        len(
            history.history['accuracy']
        ) + 1
    )


    # ─────────────────────────────────────────────
    # ACCURACY
    # ─────────────────────────────────────────────

    axes[0].plot(
        epochs,
        history.history['accuracy'],
        'b-o',
        label='Train',
        markersize=3
    )

    axes[0].plot(
        epochs,
        history.history['val_accuracy'],
        'r-o',
        label='Val',
        markersize=3
    )

    axes[0].set_title(
        'Accuracy per Epoch',
        fontsize=13
    )

    axes[0].set_xlabel('Epoch')

    axes[0].set_ylabel('Accuracy')

    axes[0].legend()

    axes[0].grid(
        True,
        alpha=0.3
    )


    # ─────────────────────────────────────────────
    # LOSS
    # ─────────────────────────────────────────────

    axes[1].plot(
        epochs,
        history.history['loss'],
        'b-o',
        label='Train',
        markersize=3
    )

    axes[1].plot(
        epochs,
        history.history['val_loss'],
        'r-o',
        label='Val',
        markersize=3
    )

    axes[1].set_title(
        'Loss per Epoch',
        fontsize=13
    )

    axes[1].set_xlabel('Epoch')

    axes[1].set_ylabel('Loss')

    axes[1].legend()

    axes[1].grid(
        True,
        alpha=0.3
    )


    # ─────────────────────────────────────────────
    # SAVE
    # ─────────────────────────────────────────────

    plt.tight_layout()

    plt.savefig(
        str(CURVES_PNG),
        dpi=120
    )

    plt.close()

    print(
        f"📈 Training curves saved to: "
        f"{CURVES_PNG}"
    )


# ─────────────────────────────────────────────────────────────────
# MAIN TRAINING PIPELINE
# ─────────────────────────────────────────────────────────────────

def main():

    print("=" * 60)

    print(
        "  Grape Master — CNN Training Pipeline"
    )

    print("=" * 60)


    # ─────────────────────────────────────────────
    # 1. CHECK DATA DIRECTORIES
    # ─────────────────────────────────────────────

    print("\n📁 Checking dataset paths...")

    print(
        f"   Training directory: {TRAIN_DIR}"
    )

    print(
        f"   Validation directory: {VAL_DIR}"
    )


    if not TRAIN_DIR.exists():

        print(
            f"\n❌ Training data not found at:"
        )

        print(
            f"   {TRAIN_DIR}"
        )

        print(
            "\nPlease check that your dataset "
            "was extracted correctly."
        )

        sys.exit(1)


    if not VAL_DIR.exists():

        print(
            f"\n❌ Validation data not found at:"
        )

        print(
            f"   {VAL_DIR}"
        )

        print(
            "\nPlease check that your dataset "
            "contains a val folder."
        )

        sys.exit(1)


    print(
        "\n✅ Training and validation "
        "directories found."
    )


    # ─────────────────────────────────────────────
    # 2. CREATE DATA GENERATORS
    # ─────────────────────────────────────────────

    print(
        "\n📂 Loading datasets..."
    )

    train_gen, val_gen = create_generators()


    # ─────────────────────────────────────────────
    # 3. DISPLAY DATASET INFORMATION
    # ─────────────────────────────────────────────

    num_classes = len(
        train_gen.class_indices
    )

    class_names = list(
        train_gen.class_indices.keys()
    )


    print(
        f"\n🍇 Classes ({num_classes}):"
    )

    for i, class_name in enumerate(
        class_names
    ):

        print(
            f"   {i}: {class_name}"
        )


    print(
        f"\n   Training samples   : "
        f"{train_gen.samples}"
    )

    print(
        f"   Validation samples : "
        f"{val_gen.samples}"
    )


    # ─────────────────────────────────────────────
    # 4. CHECK NUMBER OF CLASSES
    # ─────────────────────────────────────────────

    if num_classes < 2:

        print(
            "\n❌ ERROR: Less than 2 classes "
            "were detected."
        )

        print(
            "Please check your train directory."
        )

        sys.exit(1)


    # ─────────────────────────────────────────────
    # 5. COMPUTE CLASS WEIGHTS
    # ─────────────────────────────────────────────

    class_weights = get_class_weights(
        train_gen
    )


    # ─────────────────────────────────────────────
    # 6. BUILD MODEL
    # ─────────────────────────────────────────────

    print(
        "\n🧠 Building custom CNN architecture..."
    )

    model = build_cnn(
        num_classes
    )


    # Display model architecture
    model.summary()


    # ─────────────────────────────────────────────
    # 7. COMPILE MODEL
    # ─────────────────────────────────────────────

    optimizer = tf.keras.optimizers.Adam(
        learning_rate=LEARNING_RATE
    )


    model.compile(

        optimizer=optimizer,

        loss='categorical_crossentropy',

        metrics=['accuracy']
    )


    print(
        "\n✅ Model compiled successfully."
    )


    # ─────────────────────────────────────────────
    # 8. CALLBACKS
    # ─────────────────────────────────────────────

    callbacks = [

        # ─────────────────────────────────────────
        # SAVE BEST MODEL
        # ─────────────────────────────────────────

        ModelCheckpoint(

            str(MODEL_SAVE),

            monitor='val_loss',

            save_best_only=True,

            verbose=1
        ),


        # ─────────────────────────────────────────
        # EARLY STOPPING
        # ─────────────────────────────────────────

        EarlyStopping(

            monitor='val_loss',

            patience=12,

            restore_best_weights=True,

            verbose=1
        ),


        # ─────────────────────────────────────────
        # REDUCE LEARNING RATE
        # ─────────────────────────────────────────

        ReduceLROnPlateau(

            monitor='val_loss',

            factor=0.5,

            patience=5,

            min_lr=1e-7,

            verbose=1
        ),


        # ─────────────────────────────────────────
        # SAVE TRAINING LOG
        # ─────────────────────────────────────────

        CSVLogger(

            str(LOGS_CSV),

            append=False
        )
    ]


    # ─────────────────────────────────────────────
    # 9. START TRAINING
    # ─────────────────────────────────────────────

    print(
        f"\n🚂 Starting training for up to "
        f"{EPOCHS} epochs..."
    )

    print(
        f"   Batch size      : {BATCH_SIZE}"
    )

    print(
        f"   Image size      : "
        f"{IMG_SIZE} × {IMG_SIZE}"
    )

    print(
        f"   Learning rate   : "
        f"{LEARNING_RATE}"
    )

    print(
        f"   Best model      : "
        f"{MODEL_SAVE}"
    )

    print(
        "\n   EarlyStopping will halt training "
        "automatically if validation loss "
        "stops improving.\n"
    )


    # ─────────────────────────────────────────────
    # 10. TRAIN
    # ─────────────────────────────────────────────

    history = model.fit(

        train_gen,

        epochs=EPOCHS,

        validation_data=val_gen,

        callbacks=callbacks,

        class_weight=class_weights,

        verbose=1
    )


    # ─────────────────────────────────────────────
    # 11. SAVE TRAINING CURVES
    # ─────────────────────────────────────────────

    save_training_curves(
        history
    )


    # ─────────────────────────────────────────────
    # 12. FINAL SUMMARY
    # ─────────────────────────────────────────────

    best_val_acc = max(
        history.history['val_accuracy']
    )

    best_val_loss = min(
        history.history['val_loss']
    )


    print(
        "\n" + "=" * 60
    )

    print(
        "  ✅ Training Complete!"
    )

    print(
        "=" * 60
    )

    print(
        f"  Best Val Accuracy : "
        f"{best_val_acc * 100:.2f}%"
    )

    print(
        f"  Best Val Loss     : "
        f"{best_val_loss:.4f}"
    )

    print(
        f"  Model saved to    : "
        f"{MODEL_SAVE}"
    )

    print(
        f"  Training log      : "
        f"{LOGS_CSV}"
    )

    print(
        f"  Training curves   : "
        f"{CURVES_PNG}"
    )

    print(
        "=" * 60
    )

    print(
        "\n🎉 Your CNN training has finished."
    )


# ─────────────────────────────────────────────────────────────────
# PROGRAM ENTRY POINT
# ─────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    main()

