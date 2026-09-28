"""Text / number / date helpers (notebook §3, top).

Ported verbatim from cb_forest_ingest.py; config-free so both config.py
and fetchers.py can use them.
"""

import datetime as _dt
import hashlib
import math
import re
import time
import unicodedata

NULL_TOKENS = {"", "NONE", "NULL", "NA", "N/A", "N A", "NAN", "-", "--", "0.0"}

def first_valid(*values):
    """First non-null, non-empty value as a stripped string."""
    for v in values:
        if v is None:
            continue
        s = str(v).strip()
        if s and s.upper() not in NULL_TOKENS:
            return s
    return None

def norm_text(s):
    """Accent-free, upper-case, alphanumeric tokens separated by single spaces."""
    if s is None:
        return ""
    s = unicodedata.normalize("NFKD", str(s))
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"[^A-Za-z0-9]+", " ", s).strip().upper()
    return re.sub(r"\s+", " ", s)

def digits_only(s):
    return re.sub(r"\D", "", str(s or ""))

def trunc(s, n):
    if s is None:
        return None
    s = str(s)
    return s if len(s) <= n else s[:n]

def sha16(*parts):
    return hashlib.sha1("|".join("" if p is None else str(p) for p in parts).encode("utf-8")).hexdigest()[:16]

def parse_num(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return None if (isinstance(v, float) and math.isnan(v)) else float(v)
    s = str(v).strip().replace(" ", "").replace(" ", "")
    if not s or s.upper() in NULL_TOKENS:
        return None
    if "," in s and "." not in s:
        s = s.replace(",", ".")
    else:
        s = s.replace(",", "")
    try:
        return float(s)
    except ValueError:
        m = re.search(r"-?\d+(?:\.\d+)?", s)
        return float(m.group()) if m else None

def parse_int(v):
    f = parse_num(v)
    return None if f is None else int(round(f))

def parse_date_any(v):
    """Return epoch milliseconds (UTC) or None. Accepts epoch ms, ISO strings, dd/mm/yyyy, yyyy."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        if isinstance(v, float) and math.isnan(v):
            return None
        if v > 1e11 or v < -1e11:          # epoch ms
            return valid_ms(v)
        if v > 1e8:                        # epoch s
            return valid_ms(v * 1000)
        if 1900 < v < 2100:                # bare year
            return int(_dt.datetime(int(v), 1, 1, tzinfo=_dt.timezone.utc).timestamp() * 1000)
        return None
    s = str(v).strip()
    if not s or s.upper() in NULL_TOKENS:
        return None
    if re.fullmatch(r"\d{4}(\.0)?", s):
        y = int(float(s))
        return int(_dt.datetime(y, 1, 1, tzinfo=_dt.timezone.utc).timestamp() * 1000) if 1900 < y < 2100 else None
    if re.fullmatch(r"-?\d{12,14}", s):
        return valid_ms(s)
    for fmt in ("%Y-%m-%dT%H:%M:%S.%f%z", "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%dT%H:%M:%SZ",
                "%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d", "%m/%d/%Y", "%d.%m.%Y", "%d/%m/%y",
                "%Y%m%d", "%B %Y", "%b %Y", "%m/%Y", "%Y-%m"):
        try:
            dt = _dt.datetime.strptime(s, fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=_dt.timezone.utc)
            return int(dt.timestamp() * 1000)
        except ValueError:
            continue
    m = re.search(r"\b(19[5-9]\d|20[0-4]\d)\b", s)
    if m:
        return int(_dt.datetime(int(m.group(1)), 1, 1, tzinfo=_dt.timezone.utc).timestamp() * 1000)
    return None

MIN_MS = int(_dt.datetime(1900, 1, 1, tzinfo=_dt.timezone.utc).timestamp() * 1000)
MAX_MS = int(_dt.datetime(2100, 1, 1, tzinfo=_dt.timezone.utc).timestamp() * 1000)

def valid_ms(ms):
    """Epoch ms inside 1900..2100, else None (source layers carry sentinel dates such as year 9999 or 0001)."""
    try:
        ms = int(ms)
    except (TypeError, ValueError):
        return None
    return ms if MIN_MS <= ms <= MAX_MS else None

def ms_to_datetime(ms):
    ms = valid_ms(ms)
    return None if ms is None else _dt.datetime(1970, 1, 1) + _dt.timedelta(milliseconds=ms)

def map_vocab(value, rules, default="unknown"):
    n = norm_text(value)
    if not n:
        return None
    for pattern, std in rules:
        if re.search(pattern, n):
            return std
    return default

def decode(value, domain_map):
    """Coded value -> domain label (keeps the raw value when no domain)."""
    if value is None:
        return None
    if domain_map:
        key = str(value).strip()
        if key in domain_map:
            return domain_map[key]
        low = {k.lower(): v for k, v in domain_map.items()}
        if key.lower() in low:
            return low[key.lower()]
    return first_valid(value)

def now_ms():
    return int(time.time() * 1000)
