#!/usr/bin/env python3
"""
generate_cities.py — City data generator for OpenCodeABs/UX globe.

Reads a master city list (or uses built-in defaults), computes additional
data (Haversine distances, arc midpoints), and writes src/data/cities.json
as a validated JSON artifact.

Usage:
    python scripts/generate_cities.py              # use defaults
    python scripts/generate_cities.py --input cities_master.csv
    python scripts/generate_cities.py --validate   # only validate existing file
"""

import argparse
import json
import math
import os
import sys
from dataclasses import dataclass, field, asdict
from typing import List, Optional, Tuple

# ─── Constants ───────────────────────────────────────────────────────────────

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUTPUT_PATH = os.path.join(PROJECT_ROOT, "src", "data", "cities.json")
EARTH_RADIUS_KM = 6371.0

# ─── Data Types ──────────────────────────────────────────────────────────────

@dataclass
class City:
    id: str
    name: str
    location: Tuple[float, float]  # (lat, lng)
    label: str = ""

@dataclass
class Arc:
    from_: str  # city id
    to: str     # city id
    color: Tuple[float, float, float] = (0.3, 0.8, 1.0)

# ─── Default Data ────────────────────────────────────────────────────────────

DEFAULT_CITIES: List[City] = [
    City("sf",     "San Francisco",   (37.77, -122.42)),
    City("nyc",    "New York",        (40.71,  -74.01)),
    City("london", "London",          (51.50,   -0.12)),
    City("tokyo",  "Tokyo",           (35.68,  139.69)),
    City("sydney", "Sydney",         (-33.87, 151.21)),
    City("delhi",  "Delhi",           (28.61,   77.23)),
    City("shanghai", "Shanghai",      (31.23,  121.47)),
    City("moscow", "Moscow",          (55.76,   37.62)),
    City("dubai",  "Dubai",           (25.20,   55.27)),
    City("singapore", "Singapore",    (1.35,   103.82)),
    City("rio",    "Rio de Janeiro", (-22.91,  -43.17)),
    City("capetown", "Cape Town",   (-33.92,   18.42)),
    City("dakar",  "Dakar",          (14.72,  -17.47)),
    City("oslo",   "Oslo",            (59.91,   10.75)),
    City("ist",    "Istanbul",        (41.01,   28.98)),
]

DEFAULT_ARCS: List[Arc] = [
    Arc("sf", "tokyo"),
    Arc("nyc", "london"),
    Arc("london", "dubai"),
    Arc("tokyo", "sydney"),
    Arc("sf", "shanghai"),
    Arc("delhi", "shanghai"),
    Arc("moscow", "dubai"),
    Arc("singapore", "sydney"),
    Arc("rio", "capetown"),
]

DEFAULT_COLORS = {
    "base": [0.05, 0.08, 0.20],
    "marker": [0.10, 0.60, 1.00],
    "glow": [0.00, 0.40, 0.80],
    "arc": [0.30, 0.80, 1.00],
    "self": [0.30, 1.00, 1.00],
    "peerArc": [0.30, 0.80, 1.00],
}

DEFAULT_GLOBE_PARAMS = {
    "autoRotateSpeed": 0.005,
    "dragSensitivity": 0.004,
    "friction": 0.5,
    "velocityThreshold": 0.005,
    "resolutionScale": 2,
    "maxGlobeSize": 540,
    "minGlobeSize": 280,
    "theta": 0.35,
}

# ─── Helpers ─────────────────────────────────────────────────────────────────

def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance in km between two lat/lng points."""
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(a))

def validate_json(data: dict) -> List[str]:
    """Validate the cities.json structure. Returns list of issues (empty = valid)."""
    errors: List[str] = []
    cities = data.get("cities", [])
    arcs = data.get("arcs", [])

    if not cities:
        errors.append("No cities defined")

    city_ids = {}
    for i, c in enumerate(cities):
        cid = c.get("id", "")
        if not cid:
            errors.append(f"City {i} missing 'id'")
            continue
        if cid in city_ids:
            errors.append(f"Duplicate city id '{cid}'")
        city_ids[cid] = c
        loc = c.get("location", [])
        if len(loc) != 2:
            errors.append(f"City '{cid}': location must be [lat, lng]")
        else:
            lat, lng = loc
            if not (-90 <= lat <= 90):
                errors.append(f"City '{cid}': lat {lat} out of range")
            if not (-180 <= lng <= 180):
                errors.append(f"City '{cid}': lng {lng} out of range")

    for i, a in enumerate(arcs):
        if a.get("from") not in city_ids:
            errors.append(f"Arc {i}: unknown from city '{a.get('from')}'")
        if a.get("to") not in city_ids:
            errors.append(f"Arc {i}: unknown to city '{a.get('to')}'")

    for key in ("colors", "globe"):
        if key not in data:
            errors.append(f"Missing top-level key: '{key}'")

    return errors

# ─── Main ────────────────────────────────────────────────────────────────────

def build_data(
    cities: Optional[List[City]] = None,
    arcs: Optional[List[Arc]] = None,
    colors: Optional[dict] = None,
    globe_params: Optional[dict] = None,
) -> dict:
    if cities is None:
        cities = DEFAULT_CITIES
    if arcs is None:
        arcs = DEFAULT_ARCS
    """Build the full cities.json data structure."""
    city_list = []
    for c in cities:
        entry = asdict(c)
        entry.pop("label", None)
        city_list.append(entry)

    arc_list = []
    for a in arcs:
        arc_list.append({
            "from": a.from_,
            "to": a.to,
            "color": list(a.color),
        })

    return {
        "cities": city_list,
        "arcs": arc_list,
        "colors": colors or DEFAULT_COLORS,
        "globe": globe_params or DEFAULT_GLOBE_PARAMS,
    }

def write_json(data: dict, path: str = OUTPUT_PATH):
    """Write validated JSON to the target file."""
    errors = validate_json(data)
    if errors:
        print("Validation errors:")
        for e in errors:
            print(f"  ❌ {e}")
        sys.exit(1)

    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    print(f"✅ Wrote {len(data['cities'])} cities, {len(data['arcs'])} arcs to {path}")

def main():
    parser = argparse.ArgumentParser(description="Generate cities.json for COBE globe")
    parser.add_argument("--input", help="CSV input file (lat,lng,name)")
    parser.add_argument("--validate", action="store_true", help="Only validate existing file")
    args = parser.parse_args()

    if args.validate:
        with open(OUTPUT_PATH, "r") as f:
            data = json.load(f)
        errors = validate_json(data)
        if errors:
            for e in errors:
                print(f"  ❌ {e}")
            sys.exit(1)
        print(f"✅ {OUTPUT_PATH} is valid")
        return

    if args.input:
        # TODO: parse CSV input
        print("CSV input not yet implemented, using defaults")
        data = build_data()
    else:
        data = build_data()

    write_json(data)

if __name__ == "__main__":
    main()
