"""Documents collection (notebook §5, documents block)."""

import re
import threading
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor

from .config import DOC_CATEGORY_RULES, DOC_WORKERS, GEOCFCL_SCRAPE_ALL, HTTP_TIMEOUT, log
from .fetchers import _oid_of, fetch_arcgis_layer, get_json, http, layer_meta
from .helpers import first_valid, norm_text, digits_only, parse_date_any, parse_int, sha16, trunc
from .schema import field_names

def infer_category(*texts):
    for t in texts:
        n = norm_text(t)
        if not n:
            continue
        for pattern, cat in DOC_CATEGORY_RULES:
            if re.search(pattern, n):
                return cat
    return "other"

def doc_row(parent, title, category_raw, file_name, content_type, size, url, src_system, att_id=None):
    title = first_valid(title, file_name) or "document"
    row = {k: None for k in field_names("documents")}
    row.update({
        "doc_uid": f"{parent['src_uid']}:doc:{att_id if att_id is not None else sha16(url)}",
        "parent_uid": parent["src_uid"], "parent_layer": parent["layer"], "country": parent["country"], "iso3": parent["iso3"],
        "title": trunc(title, 255), "category_raw": trunc(category_raw, 120), "category_std": infer_category(category_raw, title, file_name),
        "file_name": trunc(file_name, 255), "content_type": trunc(content_type, 80), "size_bytes": parse_int(size),
        "date_doc": parse_date_any(re.search(r"(19[5-9]\d|20[0-4]\d)", str(file_name or "")).group(1)) if re.search(r"(19[5-9]\d|20[0-4]\d)", str(file_name or "")) else None,
        "url": trunc(url, 1000), "src_system": src_system, "retired": 0,
    })
    return row

def _attachment_url(layer_url, oid, att_id):
    return f"{layer_url}/{oid}/attachments/{att_id}"

def docs_agol_attachments(spec, recs):
    url = spec["url"]
    by_oid = {r["src_oid"]: r for r in recs if r.get("src_oid") is not None}
    oids = list(by_oid)
    rows = []
    for i in range(0, len(oids), 100):
        chunk = oids[i:i + 100]
        try:
            d = get_json(url + "/queryAttachments", {"objectIds": ",".join(map(str, chunk)), "returnUrl": "true"}, method="POST")
        except Exception as e:
            log(f"  queryAttachments failed for {url} chunk {i}: {e}", "WARN")
            continue
        for g in d.get("attachmentGroups", []):
            parent = by_oid.get(g.get("parentObjectId"))
            if not parent:
                continue
            for a in g.get("attachmentInfos", []):
                rows.append(doc_row(parent, a.get("name"), None, a.get("name"), a.get("contentType"), a.get("size"),
                                    a.get("url") or _attachment_url(url, g["parentObjectId"], a["id"]), "agol_attachment", a.get("id")))
    return rows

def docs_mapserver_attachments(spec, recs):
    dspec = spec["docs"]
    durl = dspec["url"]
    jc, jp = dspec.get("join_child"), dspec.get("join_parent")
    jac, jap = dspec.get("join_alt_child"), dspec.get("join_alt_parent")
    try:
        oid_field = layer_meta(durl).get("objectIdField") or "OBJECTID"
        fields = ",".join(x for x in [oid_field, jc, jac] if x)
        feats, meta = fetch_arcgis_layer(durl, out_fields=fields, geometry=False)
    except Exception as e:
        log(f"  document layer query failed {durl}: {e}", "WARN")
        return []
    # index parents
    def idx(field):
        ex, dg = defaultdict(list), defaultdict(list)
        for r in recs:
            v = r.get(field)
            if first_valid(v):
                ex[norm_text(v)].append(r)
                if len(digits_only(v)) >= 3:
                    dg[digits_only(v)].append(r)
        return ex, dg
    idx_p = idx(jp) if jp else ({}, {})
    idx_ap = idx(jap) if jap else ({}, {})
    pairs = []
    for f in feats:
        a = f.get("attributes") or {}
        oid = _oid_of(a, meta)
        parent = None
        for val, (ex, dg) in ((a.get(jc), idx_p), (a.get(jac), idx_ap)):
            if not first_valid(val):
                continue
            c = ex.get(norm_text(val)) or (dg.get(digits_only(val)) if len(digits_only(val)) >= 3 else None)
            if c:
                parent = c[0]
                break
        if parent and oid is not None:
            pairs.append((oid, parent))
    rows = []
    def fetch_one(oid, parent):
        try:
            d = get_json(f"{durl}/{oid}/attachments")
        except Exception as e:
            return []
        return [doc_row(parent, a.get("name"), None, a.get("name"), a.get("contentType"), a.get("size"),
                        _attachment_url(durl, oid, a["id"]), "forest_atlas_mapserver", a.get("id")) for a in d.get("attachmentInfos", [])]
    with ThreadPoolExecutor(max_workers=DOC_WORKERS) as ex:
        for res in ex.map(lambda p: fetch_one(*p), pairs):
            rows.extend(res)
    return rows

_GEOCFCL_LINK_RE = re.compile(r'<a[^>]+href="(https://cfdb-media\.s3\.[^"]+)"[^>]*>(.*?)</a>', re.S | re.I)
_GEOCFCL_LABEL_RE = re.compile(r'(?:<label[^>]*>|<strong>|<b>|<h[3-6][^>]*>|<td[^>]*>|<dt[^>]*>)\s*([^<]{3,120}?)\s*(?:</label>|</strong>|</b>|</h[3-6]>|</td>|</dt>)', re.S | re.I)

def docs_geocfcl(spec, recs):
    page_tpl = spec["docs"]["page"]
    targets = [r for r in recs if GEOCFCL_SCRAPE_ALL or r.get("status_std") == "attributed"]
    rows = []
    lock = threading.Lock()
    def fetch_one(r):
        app_id = r["src_oid"]
        try:
            time.sleep(0.15)
            resp = http().get(page_tpl.format(id=app_id), timeout=HTTP_TIMEOUT)
            if resp.status_code != 200:
                return []
            html = resp.text
        except Exception:
            return []
        out = []
        for m in _GEOCFCL_LINK_RE.finditer(html):
            url, inner = m.group(1), re.sub(r"<[^>]+>", " ", m.group(2))
            inner = re.sub(r"\s+", " ", inner).strip()
            # nearest label before the link
            before = html[max(0, m.start() - 1500):m.start()]
            labels = _GEOCFCL_LABEL_RE.findall(before)
            label = re.sub(r"\s+", " ", labels[-1]).strip() if labels else None
            fname = url.rsplit("/", 1)[-1]
            title = first_valid(label, inner if len(inner) > 3 and "télécharger" not in inner.lower() and "download" not in inner.lower() else None, fname)
            out.append(doc_row(r, title, label or inner, fname, "application/pdf" if fname.lower().endswith(".pdf") else None, None, url, "geocfcl"))
        return out
    with ThreadPoolExecutor(max_workers=min(4, DOC_WORKERS)) as ex:
        for res in ex.map(fetch_one, targets):
            rows.extend(res)
    return rows

def collect_docs(spec, recs):
    kind = (spec.get("docs") or {}).get("kind")
    if not kind or not recs:
        return []
    if kind == "agol_attachments":
        return docs_agol_attachments(spec, recs)
    if kind == "mapserver_attachments":
        return docs_mapserver_attachments(spec, recs)
    if kind == "geocfcl_html":
        return docs_geocfcl(spec, recs)
