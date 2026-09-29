import { useEffect, useMemo, useState } from "react";
import { buildWhere } from "@/filters";
import { useAppStore } from "@/core/store";
import { useMapStore } from "@/features/map/mapStore";
import { applyFilterState } from "@/services/layers";
import { queryCount, Runner } from "@/services/query";

/** Pushes the applied filters to the layers and keeps the match count fresh. */
export function useApplyFilters(): number | null {
  const pes = useMapStore((m) => m.pes);
  const applied = useAppStore((st) => st.applied);
  const [count, setCount] = useState<number | null>(null);
  const runner = useMemo(() => new Runner(), []);
  useEffect(() => {
    if (!pes) return;
    applyFilterState(pes.all, applied);
    useMapStore.getState().clearSelection();
    const layer = pes.applications;
    if (!layer) return;
    const signal = runner.start();
    queryCount(layer, { where: buildWhere(layer, applied) }, signal)
      .then((n) => !signal.aborted && setCount(n))
      .catch(() => !signal.aborted && setCount(null));
    return () => runner.cancel();
  }, [pes, applied, runner]);
  return count;
}

