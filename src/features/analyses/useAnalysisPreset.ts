import { useEffect } from "react";
import { useMapStore } from "@/features/map/mapStore";
import { applyAnalysisPreset, restoreVisibility } from "@/services/layers";

/** While mounted, the shared map shows only the contracts layer; the previous visibilities come back on unmount. */
export function useAnalysisPreset(): void {
  const map = useMapStore((m) => m.map);
  const pes = useMapStore((m) => m.pes);
  useEffect(() => {
    if (!map || !pes) return;
    const snapshot = applyAnalysisPreset(map, pes);
    return () => restoreVisibility(snapshot);
  }, [map, pes]);
}
