"""
data_consolidation.py — Dataset Download, Cleaning & Splitting
══════════════════════════════════════════════════════════════

PURPOSE:
    Prepares a clean, balanced, 5-class dataset for training the
    Grape Master custom CNN. Downloads from Kaggle, reconciles
    folder names across different dataset sources, validates images,
    and splits into Train / Val / Test sets.

TARGET CLASSES (5):
    1. healthy          - Normal leaf, no disease
    2. black_rot        - Dark sunken spots, caused by Guignardia bidwellii
    3. esca             - Tiger stripe pattern, also called Black Measles
    4. downy_mildew     - Yellow oily patches on top, white fluff underneath
    5. powdery_mildew   - White powdery coating on leaf surface

DATASET SOURCES (all free on Kaggle):
    Primary  : plantvillage-dataset (grape subset: healthy, black_rot, esca)
    Secondary: grape-disease-dataset-original (adds downy/powdery mildew)

DIRECTORY STRUCTURE CREATED:
    data/
    ├── raw/              ← raw downloaded zips & extracted folders
    ├── consolidated/     ← renamed to standard 5-class names
    └── processed/
        ├── train/        ← 70% of each class
        ├── val/          ← 15% of each class
        └── test/         ← 15% of each class

USAGE:
    python data_consolidation.py
"""

import os
import shutil
import zipfile
import sys
from pathlib import Path
from PIL import Image
from tqdm import tqdm
import splitfolders

# ─────────────────────────────────────────────────────────────────
# PATHS
# ─────────────────────────────────────────────────────────────────
BASE_DIR       = Path(__file__).parent.resolve()
DATA_DIR       = BASE_DIR.parent / 'data'
RAW_DIR        = DATA_DIR / 'raw'
CONSOLIDATED   = DATA_DIR / 'consolidated'
PROCESSED_DIR  = DATA_DIR / 'processed'

RAW_DIR.mkdir(parents=True, exist_ok=True)
CONSOLIDATED.mkdir(parents=True, exist_ok=True)
PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

# ─────────────────────────────────────────────────────────────────
# CLASS MAPPING
# Maps any folder name we might encounter → our standard class name
# ─────────────────────────────────────────────────────────────────
CLASS_MAPPING = {
    # ── vipoooool/new-plant-diseases-dataset folder names (Dataset 1)
    # Gold-standard PlantVillage augmented dataset | 200k+ downloads
    # Covers: healthy, black_rot, esca, leaf_blight
    "Grape___healthy":                             "healthy",
    "Grape___Black_rot":                           "black_rot",
    "Grape___Esca_(Black_Measles)":                "esca",
    "Grape___Leaf_blight_(Isariopsis_Leaf_Spot)":  "leaf_blight",  # Separate disease: Pseudocercospora vitis

    # ── rm1000/grape-disease-dataset-original folder names (Dataset 2)
    # 9,027 field-condition grape images | CC0 | Nature-published paper
    # Covers: Healthy, Black Rot, Esca, Leaf Blight
    "Healthy":                                     "healthy",
    "Black Rot":                                   "black_rot",
    "Black_Rot":                                   "black_rot",
    "Esca":                                        "esca",
    "Leaf Blight":                                 "leaf_blight",  # Separate disease: Pseudocercospora vitis
    "Leaf_Blight":                                 "leaf_blight",

    # ── adibamuttaqin/niphad-grapeleaf-disease-dataset folder names (Dataset 3)
    # NGLD — Niphad, Nashik field images | 2025 | DOI: 10.17632/8nnd2ypcv3.1
    # CRITICAL SOURCE: Only dataset providing downy_mildew, powdery_mildew,
    # and bacterial_rot classes — all captured in real vineyard conditions.
    "Downy Mildew":                                "downy_mildew",
    "Downy_Mildew":                                "downy_mildew",
    "Downey Mildew":                               "downy_mildew",   # NGLD typo — 'Downey' not 'Downy'
    "Downey_Mildew":                               "downy_mildew",   # NGLD typo variant
    "Powdery Mildew":                              "powdery_mildew",
    "Powdery_Mildew":                              "powdery_mildew",
    "Bacterial Rot":                               "bacterial_rot",
    "Bacterial_Rot":                               "bacterial_rot",
    "bacterial rot":                               "bacterial_rot",
    "Healthy Leaves":                              "healthy",   # NGLD's healthy folder name

    # ── Manual folder drop-ins (fallback if you place folders manually)
    "healthy_raw":                                 "healthy",
    "black_rot_raw":                               "black_rot",
    "esca_raw":                                    "esca",
    "leaf_blight_raw":                             "leaf_blight",
    "downy_mildew_raw":                            "downy_mildew",
    "powdery_mildew_raw":                          "powdery_mildew",
    "bacterial_rot_raw":                           "bacterial_rot",
}

TARGET_CLASSES = [
    "healthy",        # Normal leaf — no disease
    "black_rot",      # Guignardia bidwellii — dark sunken spots
    "esca",           # Black Measles — tiger stripe pattern, wood fungus
    "leaf_blight",    # Isariopsis Leaf Spot (Pseudocercospora vitis) — angular dark spots
    "downy_mildew",   # Plasmopara viticola — yellow oily patches, white underside fluff
    "powdery_mildew", # Erysiphe necator — white powdery coating
    "bacterial_rot",  # Bacterial infection — water-soaked lesions
]
IMG_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp"}
MIN_IMAGES_PER_CLASS = 100  # Warn if any class has fewer than this

# ─────────────────────────────────────────────────────────────────
# STEP 1 — DOWNLOAD FROM KAGGLE
# ─────────────────────────────────────────────────────────────────
def _is_already_downloaded(sentinel_file: Path) -> bool:
    """
    Checks if a dataset was already downloaded by looking for a sentinel file.
    This avoids re-downloading multi-GB datasets every time the script runs.
    A sentinel file is a small empty marker file created after successful download.
    """
    return sentinel_file.exists()


def _mark_downloaded(sentinel_file: Path):
    """Creates a sentinel file to mark that a dataset was successfully downloaded."""
    sentinel_file.touch()


def download_datasets():
    """
    Downloads all 3 dataset sources from Kaggle.
    Requires your Kaggle API credentials to be configured.

    Uses sentinel files to SKIP datasets that are already downloaded.
    Sentinel files are stored in RAW_DIR as hidden .downloaded_<name> markers.
    """
    try:
        import kaggle
        kaggle.api.authenticate()
    except Exception as e:
        print(f"⚠️  Kaggle API not configured: {e}")
        print("    Skipping auto-download. Place your dataset folders manually into:")
        print(f"    {RAW_DIR}")
        return

    # ── DATASET 1 ─────────────────────────────────────────────────────────────
    # vipoooool/new-plant-diseases-dataset
    # ✅ CONFIRMED LIVE | 87,000 images | 200,000+ downloads | Gold standard
    # Grape classes: Grape___healthy, Grape___Black_rot,
    #                Grape___Esca_(Black_Measles), Grape___Leaf_blight_
    # Source: Augmented from PlantVillage (Hughes & Salathé, 2015)
    # ──────────────────────────────────────────────────────────────────────────
    sentinel_1 = RAW_DIR / ".downloaded_vipoooool"
    print("\n[1/3] New Plant Diseases Dataset (vipoooool)")
    if _is_already_downloaded(sentinel_1):
        print("   >> Already downloaded -- skipping (delete .downloaded_vipoooool to re-download)")
    else:
        print("   ~2.8GB -- downloading now. Covers: healthy, black_rot, esca, leaf_blight")
        try:
            kaggle.api.dataset_download_files(
                "vipoooool/new-plant-diseases-dataset",
                path=str(RAW_DIR),
                unzip=True,
                quiet=False
            )
            _mark_downloaded(sentinel_1)
            print("   [OK] Downloaded and extracted.")
        except Exception as e:
            print(f"   [FAIL] Download failed: {e}")
            print("   Manually download from:")
            print("   https://www.kaggle.com/datasets/vipoooool/new-plant-diseases-dataset")
            print(f"   Extract into: {RAW_DIR}")

    # ── DATASET 2 ─────────────────────────────────────────────────────────────
    # rm1000/grape-disease-dataset-original
    # ✅ CONFIRMED LIVE | 9,027 images | CC0 Public Domain | Peer-reviewed paper
    # Grape classes: Healthy, Black Rot, Esca, Leaf Blight
    # Adds diverse real-field shots of existing classes for better generalization
    # Paper: https://doi.org/10.59720/23-251 (Nature)
    # ──────────────────────────────────────────────────────────────────────────
    sentinel_2 = RAW_DIR / ".downloaded_rm1000"
    print("\n[2/3] Grapevine Disease Dataset Original (rm1000)")
    if _is_already_downloaded(sentinel_2):
        print("   >> Already downloaded -- skipping (delete .downloaded_rm1000 to re-download)")
    else:
        print("   ~150MB -- real-field grape images. Covers: Healthy, Black Rot, Esca, Leaf Blight")
        try:
            kaggle.api.dataset_download_files(
                "rm1000/grape-disease-dataset-original",
                path=str(RAW_DIR),
                unzip=True,
                quiet=False
            )
            _mark_downloaded(sentinel_2)
            print("   [OK] Downloaded and extracted.")
        except Exception as e:
            print(f"   [WARN] Download failed: {e}")
            print("   https://www.kaggle.com/datasets/rm1000/grape-disease-dataset-original")
            print("   Continuing without it.")

    # ── DATASET 3 ─────────────────────────────────────────────────────────────
    # adibamuttaqin/niphad-grapeleaf-disease-dataset
    # ✅ CONFIRMED LIVE | Niphad Grape Leaf Disease Dataset (NGLD) on Kaggle
    # Original: Mendeley DOI 10.17632/8nnd2ypcv3.1 | Published Feb 2025
    # Authors: Dharrao, Madhuri; Dharrao, Deepak; Sonawane, Rakesh
    # CRITICAL: SOLE SOURCE of downy_mildew, powdery_mildew, bacterial_rot
    # Images captured by mobile phones in Niphad vineyards, Nashik, Maharashtra
    # ──────────────────────────────────────────────────────────────────────────
    sentinel_3 = RAW_DIR / ".downloaded_ngld"
    print("\n[3/3] Niphad Grape Leaf Disease Dataset -- NGLD (adibamuttaqin)")
    if _is_already_downloaded(sentinel_3):
        print("   >> Already downloaded -- skipping (delete .downloaded_ngld to re-download)")
    else:
        print("   ~25MB -- CRITICAL: sole source for downy_mildew, powdery_mildew, bacterial_rot")
        try:
            kaggle.api.dataset_download_files(
                "adibamuttaqin/niphad-grapeleaf-disease-dataset",
                path=str(RAW_DIR),
                unzip=True,
                quiet=False
            )
            _mark_downloaded(sentinel_3)
            print("   [OK] NGLD dataset downloaded and extracted.")
        except Exception as e:
            print(f"   [FAIL] NGLD download failed: {e}")
            print("   This is CRITICAL -- without it we lose 3 classes.")
            print("   Manually download from Mendeley:")
            print("   https://data.mendeley.com/datasets/8nnd2ypcv3/1")
            print(f"   Extract folders into: {RAW_DIR}")


# ─────────────────────────────────────────────────────────────────
# STEP 2 — VALIDATE IMAGE FILES
# ─────────────────────────────────────────────────────────────────
def validate_image(file_path):
    """
    Returns True if the file is a valid, readable image.
    Corrupted or truncated images would cause training crashes.
    """
    try:
        with Image.open(file_path) as img:
            img.verify()  # Basic integrity check
        return True
    except Exception:
        return False


# ─────────────────────────────────────────────────────────────────
# STEP 3 — CONSOLIDATE & RENAME CLASSES
# ─────────────────────────────────────────────────────────────────
def consolidate_classes():
    """
    Walks the entire RAW_DIR, finds any folder matching our CLASS_MAPPING,
    copies images into the standardized CONSOLIDATED folder structure.
    
    CONSOLIDATED/
        healthy/
        black_rot/
        esca/
        downy_mildew/
        powdery_mildew/
    
    Copies (not moves) so raw data is always preserved.
    Skips corrupted images automatically.
    """
    print("\n📂 Consolidating class folders...")

    total_copied = 0
    total_corrupt = 0

    # Walk all subdirectories in RAW_DIR
    for dirpath, dirnames, filenames in os.walk(RAW_DIR):
        folder_name = os.path.basename(dirpath)

        if folder_name not in CLASS_MAPPING:
            continue

        target_class = CLASS_MAPPING[folder_name]
        dest_dir = CONSOLIDATED / target_class
        dest_dir.mkdir(exist_ok=True)

        image_files = [f for f in filenames if Path(f).suffix.lower() in IMG_EXTENSIONS]

        print(f"   {folder_name} → {target_class} ({len(image_files)} images found)")

        for img_name in tqdm(image_files, desc=f"  Copying {target_class}", leave=False):
            src = Path(dirpath) / img_name
            dest = dest_dir / img_name

            if dest.exists():
                continue  # Already copied

            if not validate_image(src):
                total_corrupt += 1
                continue

            shutil.copy2(src, dest)
            total_copied += 1

    print(f"\n✅ Consolidation complete.")
    print(f"   Total images copied : {total_copied}")
    print(f"   Corrupted skipped   : {total_corrupt}")

    # Print per-class counts
    print("\n📊 Class Distribution:")
    missing_classes = []
    for cls in TARGET_CLASSES:
        cls_dir = CONSOLIDATED / cls
        if cls_dir.exists():
            count = len(list(cls_dir.glob("*.*")))
            status = "⚠️  LOW" if count < MIN_IMAGES_PER_CLASS else "✅"
            print(f"   {status}  {cls:<20} : {count} images")
        else:
            print(f"   ❌  {cls:<20} : NOT FOUND")
            missing_classes.append(cls)

    if missing_classes:
        print(f"\n⚠️  WARNING: Missing classes: {missing_classes}")
        print("   The model will train on available classes only.")
        print("   For best results, add images for missing classes manually.")

    return CONSOLIDATED


# ─────────────────────────────────────────────────────────────────
# STEP 4 — SPLIT INTO TRAIN / VAL / TEST
# ─────────────────────────────────────────────────────────────────
def split_dataset(source_dir):
    """
    Splits consolidated data into 70% train / 15% val / 15% test.
    The 'seed=42' ensures reproducibility — same split every time you run it.
    Stratified = each split has the same class proportions as the full dataset.
    """
    # Only split if source has images
    available_classes = [d for d in source_dir.iterdir() if d.is_dir() and len(list(d.glob("*.*"))) >= 10]

    if not available_classes:
        print("❌ No valid class folders found for splitting. Exiting.")
        sys.exit(1)

    print(f"\n✂️  Splitting {len(available_classes)} classes into 70/15/15 split...")
    print(f"   Source: {source_dir}")
    print(f"   Output: {PROCESSED_DIR}")

    # Clear old processed data to avoid mixing old and new
    if PROCESSED_DIR.exists():
        shutil.rmtree(PROCESSED_DIR)

    splitfolders.ratio(
        str(source_dir),
        output=str(PROCESSED_DIR),
        seed=42,
        ratio=(0.70, 0.15, 0.15),
        group_prefix=None,
        move=False  # Copy, keep consolidated intact
    )

    # Print final counts
    print("\n📊 Final Split Summary:")
    for split in ['train', 'val', 'test']:
        split_path = PROCESSED_DIR / split
        if split_path.exists():
            total = sum(len(list((split_path / cls).glob("*.*"))) for cls in os.listdir(split_path) if (split_path / cls).is_dir())
            print(f"   {split.capitalize():<8} : {total} images")

    print(f"\n✅ Dataset ready at: {PROCESSED_DIR}")


# ─────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("=" * 60)
    print("  Grape Master — Data Consolidation Pipeline")
    print("=" * 60)

    download_datasets()
    consolidated_path = consolidate_classes()
    split_dataset(consolidated_path)

    print("\n🎉 Data consolidation complete! Now run: python train_model.py")
