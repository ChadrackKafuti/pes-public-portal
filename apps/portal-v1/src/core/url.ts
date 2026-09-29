/**
 * Store ⇄ URL search params (deep links). Not wired to the router yet; the codec is tested so that
 * enabling shareable links later is a matter of calling encode/decode on navigation.
 */
import type { FilterState } from "@/filters";
import { emptyState } from "@/filters";
import { CONFIG } from "@/config";

const SEP = "|";

export function encodeFilters(state: FilterState): URLSearchParams {
  const p = new URLSearchParams();
  for (const def of CONFIG.filters) {
    const v = state.values[def.id];
    if (v?.length) p.set(def.id, v.join(SEP));
  }
  if (state.code.trim()) p.set("code", state.code.trim());
  if (state.from) p.set("from", state.from);
  if (state.to) p.set("to", state.to);
  return p;
}

export function decodeFilters(p: URLSearchParams): FilterState {
  const state = emptyState();
  for (const def of CONFIG.filters) {
    const raw = p.get(def.id);
    if (raw) state.values[def.id] = raw.split(SEP).filter(Boolean);
  }
  state.code = p.get("code") ?? "";
  state.from = p.get("from") ?? "";
  state.to = p.get("to") ?? "";
  return state;
}
