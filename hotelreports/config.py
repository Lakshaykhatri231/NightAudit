"""Settings: file locations, the two fictional clients, demo users and API keys.

Data paths are read from HOTELREPORTS_HOME each time (default: the project folder),
so tests can point the whole app at a temporary directory.
"""
from __future__ import annotations

import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
WEB_DIR = PROJECT_ROOT / "web"                      # classic single-file UI (/classic)
FRONTEND_DIST = PROJECT_ROOT / "frontend" / "dist"  # built React app (served at /)


def home() -> Path:
    return Path(os.environ.get("HOTELREPORTS_HOME", PROJECT_ROOT))


def samples_dir() -> Path:
    return home() / "data" / "samples"


def tenants_dir() -> Path:
    return home() / "data" / "tenants"


def exports_dir() -> Path:
    return home() / "exports"


PLATFORMS = ("instagram", "facebook", "tiktok")
PLATFORM_LABELS = {"instagram": "Instagram", "facebook": "Facebook", "tiktok": "TikTok"}

# Two fictional hotels. Nothing here refers to a real business.
CLIENTS = {
    "harbourlight": {
        "name": "Harbourlight Boutique Hotel",
        "location": "Coastal city waterfront",
        "brand": "#0e6e8c",
    },
    "pinecrest": {
        "name": "Pinecrest Mountain Lodge",
        "location": "Alpine ski & hiking resort",
        "brand": "#2f6b3a",
    },
}

DEMO_PASSWORD = "demo123"

# Each user belongs to exactly one client. Roles: analyst (import, generate, submit)
# and reviewer (approve / reject).
USERS = {
    "anna@harbourlight": {"name": "Anna Patel", "client_id": "harbourlight", "role": "analyst"},
    "rob@harbourlight": {"name": "Rob Chen", "client_id": "harbourlight", "role": "reviewer"},
    "paul@pinecrest": {"name": "Paul Okafor", "client_id": "pinecrest", "role": "analyst"},
    "rita@pinecrest": {"name": "Rita Novak", "client_id": "pinecrest", "role": "reviewer"},
}

# Demo API keys for curl / scripts (header: X-API-Key). Each maps to a user above.
API_KEYS = {
    "hl-analyst-demo-key": "anna@harbourlight",
    "hl-reviewer-demo-key": "rob@harbourlight",
    "pc-analyst-demo-key": "paul@pinecrest",
    "pc-reviewer-demo-key": "rita@pinecrest",
}

SESSION_TTL_SECONDS = 8 * 3600
MAX_UPLOAD_BYTES = 5 * 1024 * 1024
