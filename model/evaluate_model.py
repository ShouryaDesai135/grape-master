"""
evaluate_model.py

Evaluates the trained Grape Master CNN model against the test dataset.
Generates performance metrics suitable for academic and industry project evaluations:
- Classification Report (Per-class Precision, Recall, F1-Score)
- Confusion Matrix Heatmap
- Training History Curves (Accuracy & Loss)

Outputs are saved in an 'evaluation_results' directory.
"""

import os

# Must be set before importing tensorflow (TF 2.16+ Keras 3 compat)
os.environ['TF_USE_LEGACY_KERAS'] = '1'
os.environ['TF_ENABLE_ONEDNN_OPTS'] = '0'
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '2'

import warnings
warnings.filterwarnings('ignore')

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
from sklearn.metrics import classification_report, confusion_matrix
import tensorflow as tf
from tensorflow.keras.models import load_model
from tensorflow.keras.preprocessing.image import ImageDataGenerator

# Paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, '..', 'data', 'processed')
TEST_DIR = os.path.join(DATA_DIR, 'test')
MODEL_PATH = os.path.join(BASE_DIR, 'grape_master_cnn.h5')
LOGS_PATH = os.path.join(BASE_DIR, 'training_history.csv')
RESULTS_DIR = os.path.join(BASE_DIR, 'evaluation_results')

os.makedirs(RESULTS_DIR, exist_ok=True)

def plot_training_curves():
    """Plots training vs validation accuracy and loss from CSV log."""
    if not os.path.exists(LOGS_PATH):
        print("Training logs not found. Skipping training curves.")
        return

    history_df = pd.read_csv(LOGS_PATH)
    epochs = range(1, len(history_df) + 1)

    plt.figure(figsize=(14, 5))

    # Accuracy Plot
    plt.subplot(1, 2, 1)
    plt.plot(epochs, history_df['accuracy'], label='Train Accuracy', marker='o')
    plt.plot(epochs, history_df['val_accuracy'], label='Val Accuracy', marker='o')
    plt.title('Training and Validation Accuracy')
    plt.xlabel('Epochs')
    plt.ylabel('Accuracy')
    plt.legend()
    plt.grid(True)

    # Loss Plot
    plt.subplot(1, 2, 2)
    plt.plot(epochs, history_df['loss'], label='Train Loss', marker='o')
    plt.plot(epochs, history_df['val_loss'], label='Val Loss', marker='o')
    plt.title('Training and Validation Loss')
    plt.xlabel('Epochs')
    plt.ylabel('Loss')
    plt.legend()
    plt.grid(True)

    plt.tight_layout()
    plot_path = os.path.join(RESULTS_DIR, 'training_curves.png')
    plt.savefig(plot_path)
    plt.close()
    print(f"Training curves saved to {plot_path}")

def evaluate_model():
    """Evaluates the model on the test set and generates metrics."""
    if not os.path.exists(MODEL_PATH):
        print(f"Model not found at {MODEL_PATH}. Please train the model first.")
        return
    if not os.path.exists(TEST_DIR):
        print(f"Test directory not found at {TEST_DIR}. Please run data_consolidation.py.")
        return

    print("Loading model...")
    # Compile=False is fine for inference
    model = load_model(MODEL_PATH, compile=False)

    print("Preparing test data generator...")
    test_datagen = ImageDataGenerator(rescale=1./255)
    test_generator = test_datagen.flow_from_directory(
        TEST_DIR,
        target_size=(224, 224),
        batch_size=32,
        class_mode='categorical',
        shuffle=False # Crucial for matching predictions to filenames
    )

    print("Predicting on test set...")
    predictions = model.predict(test_generator, verbose=1)
    y_pred = np.argmax(predictions, axis=1)
    y_true = test_generator.classes
    class_names = list(test_generator.class_indices.keys())

    # 1. Classification Report
    print("\n--- Classification Report ---")
    report = classification_report(y_true, y_pred, target_names=class_names)
    print(report)
    
    # Save report to text file
    with open(os.path.join(RESULTS_DIR, 'classification_report.txt'), 'w') as f:
        f.write("--- Classification Report ---\n")
        f.write(report)

    # 2. Confusion Matrix Heatmap
    cm = confusion_matrix(y_true, y_pred)
    plt.figure(figsize=(10, 8))
    sns.heatmap(cm, annot=True, fmt='d', cmap='Blues', 
                xticklabels=class_names, yticklabels=class_names)
    plt.title('Confusion Matrix - Test Set')
    plt.ylabel('Actual Class')
    plt.xlabel('Predicted Class')
    plt.xticks(rotation=45, ha='right')
    plt.tight_layout()
    
    cm_plot_path = os.path.join(RESULTS_DIR, 'confusion_matrix.png')
    plt.savefig(cm_plot_path)
    plt.close()
    print(f"Confusion matrix saved to {cm_plot_path}")

if __name__ == "__main__":
    plot_training_curves()
    evaluate_model()
    print("Evaluation complete.")
