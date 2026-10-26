"""Philippine regions and the one mapping from location text to them.

Job locations ("Makati City, Metro Manila", "Laguna / Cavite") and a
candidate's saved profile location both go through ``regions_in_location``, so
a job and a candidate are always placed with the same rules.

A "City, Province" location takes its province's region, so a town named after
another region's province ("Quezon, Bukidnon") stays in its own region.
Only a named region, province or city places a location in a region. Vague text
("Philippines", "Remote, Philippines", "Nationwide", "Regional Office") and
places outside the country name no region: the region is unknown, never guessed.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache
from typing import Any, Dict, FrozenSet, List, Mapping, Optional, Tuple


@dataclass(frozen=True)
class Region:
    code: str
    name: str
    # Region names, provinces and cities that lie wholly in this region.
    aliases: Tuple[str, ...]


# The 18 administrative regions, in the PSA's order. Names that belong to more
# than one region ("San Fernando", "Naga", "Santa Rosa", "San Jose") are left
# out; a longer, specific alias ("Quezon City", "Cotabato City", "Isabela
# City", "Cagayan de Oro") always wins over the shorter one inside it.
REGIONS: Tuple[Region, ...] = (
    Region("NCR", "National Capital Region (Metro Manila)", (
        "ncr", "national capital region", "metro manila", "metromanila", "manila", "makati", "bgc",
        "bonifacio global city", "fort bonifacio", "taguig", "quezon city", "pasig", "ortigas", "mandaluyong",
        "pasay", "paranaque", "las pinas", "muntinlupa", "alabang", "caloocan", "malabon", "navotas",
        "valenzuela", "marikina", "san juan city", "pateros", "sampaloc", "binondo", "ermita", "eastwood",
        "mckinley hill", "cubao", "novaliches",
    )),
    Region("CAR", "Cordillera Administrative Region (CAR)", (
        "cordillera administrative region", "cordillera", "baguio", "benguet", "abra", "apayao", "ifugao",
        "kalinga", "mountain province", "la trinidad", "tabuk",
    )),
    Region("I", "Region I – Ilocos Region", (
        "region i", "region 1", "ilocos region", "ilocos", "ilocos norte", "ilocos sur", "la union",
        "pangasinan", "laoag", "vigan", "dagupan", "urdaneta", "candon", "batac",
    )),
    Region("II", "Region II – Cagayan Valley", (
        "region ii", "region 2", "cagayan valley", "cagayan", "isabela", "nueva vizcaya", "quirino",
        "batanes", "tuguegarao", "santiago city", "cauayan", "ilagan",
    )),
    Region("III", "Region III – Central Luzon", (
        "region iii", "region 3", "central luzon", "pampanga", "bulacan", "nueva ecija", "tarlac", "zambales",
        "bataan", "aurora", "clark", "angeles city", "olongapo", "subic", "malolos", "meycauayan",
        "san jose del monte", "cabanatuan", "balanga", "mabalacat",
    )),
    Region("IV-A", "Region IV-A – CALABARZON", (
        "region iv a", "region iva", "region 4a", "region 4 a", "calabarzon", "cavite", "laguna", "batangas",
        "rizal", "quezon", "quezon province", "lucena", "calamba", "san pablo city", "binan", "cabuyao",
        "bacoor", "imus", "dasmarinas", "general trias", "tagaytay", "lipa", "antipolo", "cainta", "taytay",
        "los banos",
    )),
    Region("IV-B", "MIMAROPA Region", (
        "region iv b", "region ivb", "region 4b", "region 4 b", "mimaropa", "southwestern tagalog region",
        "occidental mindoro", "oriental mindoro", "mindoro", "marinduque", "romblon", "palawan",
        "puerto princesa", "calapan",
    )),
    Region("V", "Region V – Bicol Region", (
        "region v", "region 5", "bicol region", "bicol", "albay", "camarines norte", "camarines sur",
        "catanduanes", "masbate", "sorsogon", "legazpi", "legaspi", "iriga",
    )),
    Region("VI", "Region VI – Western Visayas", (
        "region vi", "region 6", "western visayas", "iloilo", "aklan", "antique", "capiz", "guimaras",
        "boracay", "roxas city", "kalibo",
    )),
    Region("NIR", "Negros Island Region (NIR)", (
        "negros island region", "nir", "negros", "negros occidental", "negros oriental", "siquijor",
        "bacolod", "dumaguete",
    )),
    Region("VII", "Region VII – Central Visayas", (
        "region vii", "region 7", "central visayas", "cebu", "bohol", "tagbilaran", "mandaue", "lapu lapu",
    )),
    Region("VIII", "Region VIII – Eastern Visayas", (
        "region viii", "region 8", "eastern visayas", "leyte", "southern leyte", "samar", "northern samar",
        "eastern samar", "biliran", "tacloban", "ormoc", "catbalogan",
    )),
    Region("IX", "Region IX – Zamboanga Peninsula", (
        "region ix", "region 9", "zamboanga peninsula", "zamboanga", "zamboanga del norte",
        "zamboanga del sur", "zamboanga sibugay", "dipolog", "dapitan", "pagadian",
        # Isabela City lies on Basilan but belongs to Region IX. The whole
        # "Isabela City Basilan" form is listed so "basilan" does not also add BARMM.
        # "Isabela City, Basilan" is in CITIES_OUTSIDE_PROVINCE_REGION.
        "isabela city", "isabela city basilan",
    )),
    Region("X", "Region X – Northern Mindanao", (
        "region x", "region 10", "northern mindanao", "cagayan de oro", "cdo", "misamis oriental",
        "misamis occidental", "bukidnon", "camiguin", "lanao del norte", "iligan", "malaybalay", "ozamiz",
    )),
    Region("XI", "Region XI – Davao Region", (
        "region xi", "region 11", "davao region", "davao", "davao del sur", "davao del norte", "davao de oro",
        "davao oriental", "davao occidental", "tagum", "digos", "panabo",
    )),
    Region("XII", "Region XII – SOCCSKSARGEN", (
        "region xii", "region 12", "soccsksargen", "south cotabato", "cotabato", "north cotabato",
        "sultan kudarat", "sarangani", "general santos", "gensan", "koronadal", "kidapawan",
    )),
    Region("XIII", "Region XIII – Caraga", (
        "region xiii", "region 13", "caraga", "agusan", "agusan del norte", "agusan del sur", "surigao",
        "surigao del norte", "surigao del sur", "dinagat", "butuan", "bislig", "siargao", "tandag",
    )),
    Region("BARMM", "Bangsamoro Autonomous Region in Muslim Mindanao (BARMM)", (
        # Sulu (including Jolo) is not part of BARMM after the Supreme Court's 2024
        # ruling, and no other region is recorded for it here, so Sulu locations
        # name no region rather than a guessed one.
        "bangsamoro", "barmm", "armm", "maguindanao", "lanao del sur", "basilan", "tawi tawi",
        "marawi", "cotabato city",
    )),
)

REGIONS_BY_CODE: Dict[str, Region] = {region.code: region for region in REGIONS}

# The provinces of frontend/src/lib/phProvinces.ts by region; Metro Manila
# stands in for NCR. Sulu has no region on record (see BARMM above).
PROVINCES_BY_REGION: Tuple[Tuple[str, Tuple[str, ...]], ...] = (
    ("NCR", ("Metro Manila",)),
    ("CAR", ("Abra", "Apayao", "Benguet", "Ifugao", "Kalinga", "Mountain Province")),
    ("I", ("Ilocos Norte", "Ilocos Sur", "La Union", "Pangasinan")),
    ("II", ("Batanes", "Cagayan", "Isabela", "Nueva Vizcaya", "Quirino")),
    ("III", ("Aurora", "Bataan", "Bulacan", "Nueva Ecija", "Pampanga", "Tarlac", "Zambales")),
    ("IV-A", ("Batangas", "Cavite", "Laguna", "Quezon", "Rizal")),
    ("IV-B", ("Marinduque", "Occidental Mindoro", "Oriental Mindoro", "Palawan", "Romblon")),
    ("V", ("Albay", "Camarines Norte", "Camarines Sur", "Catanduanes", "Masbate", "Sorsogon")),
    ("VI", ("Aklan", "Antique", "Capiz", "Guimaras", "Iloilo")),
    ("NIR", ("Negros Occidental", "Negros Oriental", "Siquijor")),
    ("VII", ("Bohol", "Cebu")),
    ("VIII", ("Biliran", "Eastern Samar", "Leyte", "Northern Samar", "Samar", "Southern Leyte")),
    ("IX", ("Zamboanga del Norte", "Zamboanga del Sur", "Zamboanga Sibugay")),
    ("X", ("Bukidnon", "Camiguin", "Lanao del Norte", "Misamis Occidental", "Misamis Oriental")),
    ("XI", ("Davao de Oro", "Davao del Norte", "Davao del Sur", "Davao Occidental", "Davao Oriental")),
    ("XII", ("Cotabato", "Sarangani", "South Cotabato", "Sultan Kudarat")),
    ("XIII", ("Agusan del Norte", "Agusan del Sur", "Dinagat Islands", "Surigao del Norte", "Surigao del Sur")),
    ("BARMM", ("Basilan", "Lanao del Sur", "Maguindanao del Norte", "Maguindanao del Sur", "Tawi-Tawi")),
    ("", ("Sulu",)),
)

# Other spellings the province picker accepts for a province (canonicalProvince in phProvinces.ts).
PROVINCE_ALIASES: Dict[str, str] = {"NCR": "Metro Manila", "National Capital Region": "Metro Manila"}

# Cities listed under a province (phCities.ts) that belong to another region.
CITIES_OUTSIDE_PROVINCE_REGION: Dict[Tuple[str, str], str] = {
    ("Isabela City", "Basilan"): "IX",
}

# Text that lists more than one place ("Laguna / Metro Manila", "Cavite and Laguna").
_LIST_SEPARATOR = re.compile(r"[/;&|]|\band\b|\bor\b", re.IGNORECASE)

# How the candidate wants location to limit recommendations.
SCOPE_ANYWHERE = "anywhere"
SCOPE_CURRENT = "current"
SCOPE_CHOSEN = "region"
LOCATION_SCOPES = (SCOPE_ANYWHERE, SCOPE_CURRENT, SCOPE_CHOSEN)


def _normalize(value: Any) -> str:
    text = str(value or "").lower()
    # "Parañaque", "Biñan", "Las Piñas" and "Dasmariñas" are often typed without the tilde.
    text = text.replace("ñ", "n").replace(" ", " ")
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return f" {' '.join(text.split())} "


@lru_cache(maxsize=1)
def _alias_patterns() -> List[Tuple[str, str]]:
    """(normalized alias, region code), longest first so specific names win."""
    pairs = [(_normalize(alias), region.code) for region in REGIONS for alias in region.aliases]
    return sorted(pairs, key=lambda pair: len(pair[0]), reverse=True)


@lru_cache(maxsize=1)
def _province_regions() -> Dict[str, str]:
    """Normalized province name (or accepted alias) -> region code; "" for none."""
    regions = {_normalize(province): code for code, provinces in PROVINCES_BY_REGION for province in provinces}
    for alias, province in PROVINCE_ALIASES.items():
        regions[_normalize(alias)] = regions[_normalize(province)]
    return regions


@lru_cache(maxsize=1)
def _city_exceptions() -> Dict[Tuple[str, str], str]:
    return {(_normalize(city), _normalize(province)): code
            for (city, province), code in CITIES_OUTSIDE_PROVINCE_REGION.items()}


def _listed_province_regions(location: Any) -> Optional[FrozenSet[str]]:
    """The region set when a single place's last comma part is a listed province; None otherwise.

    "Quezon, Palawan" is in MIMAROPA even though "Quezon" is also a CALABARZON
    province: the province decides. Text listing several places keeps the full scan.
    """
    text = str(location or "")
    if _LIST_SEPARATOR.search(text):
        return None
    parts = [part for part in text.split(",") if part.strip()]
    if not parts:
        return None
    province = _normalize(parts[-1])
    code = _province_regions().get(province)
    if code is None:
        return None
    city = _normalize(",".join(parts[:-1]))
    code = _city_exceptions().get((city, province), code)
    return frozenset({code}) if code else frozenset()


@lru_cache(maxsize=4096)
def regions_in_location(location: Any) -> FrozenSet[str]:
    """Every region a location names; empty when it names none.

    When the last comma-separated part is a listed province ("Rizal, Kalinga"),
    that province alone decides. Otherwise every region, province and city name
    in the text counts: "Laguna / Metro Manila" names two regions, while
    "Philippines", "Remote", "Regional Office" and foreign places name none.
    """
    listed = _listed_province_regions(location)
    if listed is not None:
        return listed
    text = _normalize(location)
    found = set()
    for alias, code in _alias_patterns():
        if alias in text:
            found.add(code)
            # Consume the words so "Quezon City" does not also read as Quezon province.
            text = text.replace(alias, " | ")
    return frozenset(found)


def resolve_single_region(location: Any) -> Optional[str]:
    """The one region a candidate's location names, or None when unknown or ambiguous."""
    regions = regions_in_location(location)
    return next(iter(regions)) if len(regions) == 1 else None


def region_name(code: Any) -> str:
    region = REGIONS_BY_CODE.get(normalize_region_code(code) or "")
    return region.name if region else ""


def normalize_region_code(value: Any) -> Optional[str]:
    """A region code from a code ("iv-a", "NCR") or a region's own name; None otherwise."""
    raw = str(value or "").strip()
    if not raw:
        return None
    upper = raw.upper().replace("REGION ", "").strip()
    if upper in REGIONS_BY_CODE:
        return upper
    for region in REGIONS:
        if _normalize(region.name) == _normalize(raw):
            return region.code
    return None


class RegionPreferenceError(ValueError):
    """A region filter was asked for without a region that can be used."""


@dataclass(frozen=True)
class RegionPreference:
    scope: str
    region: Optional[str]

    @property
    def active(self) -> bool:
        return self.region is not None

    def as_dict(self) -> Dict[str, Any]:
        return {
            "location_scope": self.scope,
            "region": self.region or "",
            "region_name": region_name(self.region) if self.region else "",
            "active": self.active,
        }


def region_preference(preferences: Optional[Mapping[str, Any]]) -> RegionPreference:
    """Read the location choice from the Step 3 / dashboard preferences.

    ``location_scope``: "anywhere" (or missing) applies no filter; "current"
    uses the candidate's current region; "region" uses the region they chose.
    The region comes from ``region``; for "current" it may instead be read from
    ``current_location`` when that names exactly one region. A filter with no
    usable region is an error: the candidate is asked to choose one rather
    than having a region guessed for them.
    """
    preferences = preferences or {}
    scope = str(preferences.get("location_scope") or "").strip().lower()
    if scope in {"", SCOPE_ANYWHERE, "any", "anywhere in the philippines", "philippines"}:
        return RegionPreference(SCOPE_ANYWHERE, None)
    if scope not in {SCOPE_CURRENT, SCOPE_CHOSEN}:
        raise RegionPreferenceError("Choose where you want to work: anywhere in the Philippines, your current region, or a region.")
    code = normalize_region_code(preferences.get("region"))
    if code is None and scope == SCOPE_CURRENT:
        code = resolve_single_region(preferences.get("current_location"))
    if code is None:
        if scope == SCOPE_CURRENT:
            raise RegionPreferenceError("We could not tell your current region from your profile location. Please choose a region.")
        raise RegionPreferenceError("Please choose a region from the list.")
    return RegionPreference(scope, code)


def region_options() -> List[Dict[str, str]]:
    return [{"code": region.code, "name": region.name} for region in REGIONS]
