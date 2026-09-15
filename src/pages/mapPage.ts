/** Map page: web map + tabbed side panel (Overview, Filters, Layers) + application-code search. */
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import TileLayer from "@arcgis/core/layers/TileLayer";
import OpenStreetMapLayer from "@arcgis/core/layers/OpenStreetMapLayer";
import Basemap from "@arcgis/core/Basemap";
import type Graphic from "@arcgis/core/Graphic";
import type Layer from "@arcgis/core/layers/Layer";
import { CONFIG } from "../config";
import { t, applyTranslations } from "../i18n";
import { buildWhere, emptyState, findField, uniqueValues, type FilterState } from "../filters";
import { loadWebMap } from "../webmap";
import { installForestLayers } from "../forestLayers";

type TabName = "overview" | "filters" | "layers";

const $ = <T extends Element>(sel: string, root: ParentNode = document): T => {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`Missing element ${sel}`);
  return el;
};

export class MapPage {
  private mapEl = $<HTMLArcgisMapElement>("#map-view");
  private featureEl = $<HTMLArcgisFeatureElement>("#feature-info");
  private state: FilterState = emptyState();
  private layers: FeatureLayer[] = [];
  private optionsLayer: FeatureLayer | null = null;
  private highlight: { remove(): void } | null = null;
  private originalBasemap: Basemap | null = null;
  private started = false;

  start(): void {
    if (this.started) return;
    this.started = true;
    this.buildFilterPanel();
    this.wireBasemaps();
    this.wireSearch();
    this.mapEl.addEventListener("arcgisViewReadyChange", () => void this.onViewReady());
    this.mapEl.addEventListener("arcgisLoadError", () => this.showError());
    this.mapEl.addEventListener("arcgisViewClick", (e) => void this.onClick(e));
    document.addEventListener("pes-lang-change", () => this.relabel());
    loadWebMap(CONFIG.webmaps.map)
      .then(async (webmap) => {
        await webmap.load(); // layers exist only once the web map JSON has been parsed
        installForestLayers(webmap);
        this.mapEl.map = webmap;
      })
      .catch((err) => {
        console.error(err);
        this.showError();
      });
  }

  // ---------------------------------------------------------------- tabs
  private selectTab(name: TabName): void {
    document.querySelectorAll<HTMLCalciteTabTitleElement>("#map-tabs calcite-tab-title").forEach((title) => {
      if (title.dataset.tab === name) title.selected = true;
    });
    const panel = $<HTMLCalciteShellPanelElement>("#map-panel");
    panel.collapsed = false;
  }

  // ---------------------------------------------------------------- filters UI
  private buildFilterPanel(): void {
    const host = $<HTMLElement>("#filter-fields");
    host.innerHTML = "";
    for (const def of CONFIG.filters) {
      const label = document.createElement("calcite-label");
      label.innerHTML = `<span data-i18n="filter.${def.id}"></span>`;
      const box = document.createElement("calcite-combobox");
      box.id = `flt-${def.id}`;
      box.selectionMode = "multiple";
      box.setAttribute("data-i18n-attr", "placeholder:filter.any");
      box.scale = "s";
      box.overlayPositioning = "fixed";
      box.addEventListener("calciteComboboxChange", () => {
        this.state.values[def.id] = this.selectedValues(box);
        if (def.id === "country") void this.loadCascadingOptions();
      });
      label.appendChild(box);
      host.appendChild(label);
    }
    applyTranslations(host);

    const code = $<HTMLCalciteInputElement>("#flt-code");
    code.addEventListener("calciteInputInput", () => {
      this.state.code = code.value ?? "";
    });
    const from = $<HTMLCalciteInputDatePickerElement>("#flt-from");
    const to = $<HTMLCalciteInputDatePickerElement>("#flt-to");
    from.addEventListener("calciteInputDatePickerChange", () => (this.state.from = (from.value as string) || ""));
    to.addEventListener("calciteInputDatePickerChange", () => (this.state.to = (to.value as string) || ""));

    $<HTMLCalciteButtonElement>("#flt-apply").addEventListener("click", () => void this.applyFilters());
    $<HTMLCalciteButtonElement>("#flt-reset").addEventListener("click", () => void this.resetFilters());
  }

  private selectedValues(box: HTMLCalciteComboboxElement): string[] {
    const v = box.value;
    if (Array.isArray(v)) return v.filter((x) => x !== "");
    return v ? [String(v)] : [];
  }

  private relabel(): void {
    applyTranslations($("#page-map"));
    void this.updateCount();
  }

  // ---------------------------------------------------------------- map ready
  private async onViewReady(): Promise<void> {
    if (!this.mapEl.ready || !this.mapEl.map) return;
    const map = this.mapEl.map;
    this.originalBasemap = map.basemap ?? null;
    // the web map popups use FeatureSetByName($map, ...): give the feature panel the map and view context
    this.featureEl.map = map;
    this.featureEl.view = this.mapEl.view;
    const candidates = map.allLayers
      .filter((l: Layer) => l.type === "feature" && CONFIG.filterableLayerPattern.test((l as FeatureLayer).url ?? ""))
      .toArray() as FeatureLayer[];
    await Promise.all(candidates.map((l) => l.load().catch(() => null)));
    this.layers = candidates.filter((l) => l.loaded);
    this.ensurePopups();
    this.optionsLayer =
      this.layers.find((l) => CONFIG.applicationsLayerPattern.test(l.url ?? "")) ??
      this.layers.find((l) => findField(l, ["applicationcode"]) !== null) ??
      null;
    await this.loadOptions();
    await this.updateCount();
  }

  /**
   * Layers without a popup in the web map (e.g. the applications points) borrow the popup of a layer with the
   * same fields (the applications polygons); otherwise they get the default field list.
   */
  private ensurePopups(): void {
    const isData = (name: string) => !/^(shape__|shape_|objectid$|globalid$)/i.test(name);
    const withPopup = this.layers.filter((l) => l.popupTemplate);
    for (const layer of this.layers) {
      if (layer.popupTemplate) continue;
      const fields = new Set((layer.fields ?? []).map((f) => f.name.toLowerCase()));
      const donor = withPopup.find((d) =>
        (d.fields ?? []).filter((f) => isData(f.name)).every((f) => fields.has(f.name.toLowerCase())),
      );
      const template = donor?.popupTemplate;
      layer.popupTemplate = template ? template.clone() : layer.createPopupTemplate();
    }
  }

  private showError(): void {
    const notice = $<HTMLCalciteNoticeElement>("#map-error");
    notice.open = true;
  }

  // ---------------------------------------------------------------- filter options
  private async loadOptions(): Promise<void> {
    if (!this.optionsLayer) return;
    const status = $<HTMLElement>("#filter-status");
    status.textContent = t("filter.loading");
    await Promise.all(
      CONFIG.filters.map(async (def) => {
        const field = findField(this.optionsLayer!, def.fields);
        const box = $<HTMLCalciteComboboxElement>(`#flt-${def.id}`);
        if (!field) {
          box.disabled = true;
          return;
        }
        const values = await uniqueValues(this.optionsLayer!, field).catch(() => [] as string[]);
        this.fillCombobox(box, values);
      }),
    );
    status.textContent = "";
  }

  /** Province (and any cascading filter) restricted to the selected countries. */
  private async loadCascadingOptions(): Promise<void> {
    if (!this.optionsLayer) return;
    const countries = this.state.values["country"] ?? [];
    const countryField = findField(this.optionsLayer, ["country"]);
    const where =
      countries.length && countryField ? `${countryField} IN (${countries.map((c) => `'${c.replaceAll("'", "''")}'`).join(",")})` : "1=1";
    for (const def of CONFIG.filters.filter((d) => d.cascadesOnCountry)) {
      const field = findField(this.optionsLayer, def.fields);
      if (!field) continue;
      const box = $<HTMLCalciteComboboxElement>(`#flt-${def.id}`);
      const keep = new Set(this.state.values[def.id] ?? []);
      const values = await uniqueValues(this.optionsLayer, field, where).catch(() => [] as string[]);
      this.fillCombobox(box, values, keep);
      this.state.values[def.id] = values.filter((v) => keep.has(v));
    }
  }

  private fillCombobox(box: HTMLCalciteComboboxElement, values: string[], selected = new Set<string>()): void {
    box.innerHTML = "";
    for (const v of values) {
      const item = document.createElement("calcite-combobox-item");
      item.value = v;
      item.heading = v;
      item.selected = selected.has(v);
      box.appendChild(item);
    }
  }

  // ---------------------------------------------------------------- apply
  private async applyFilters(): Promise<void> {
    for (const layer of this.layers) {
      layer.definitionExpression = buildWhere(layer, this.state);
    }
    this.clearHighlight();
    await this.updateCount();
  }

  private async resetFilters(): Promise<void> {
    this.state = emptyState();
    document.querySelectorAll<HTMLCalciteComboboxElement>("#filter-fields calcite-combobox").forEach((box) => {
      box.querySelectorAll<HTMLCalciteComboboxItemElement>("calcite-combobox-item").forEach((i) => (i.selected = false));
    });
    $<HTMLCalciteInputElement>("#flt-code").value = "";
    $<HTMLCalciteInputDatePickerElement>("#flt-from").value = "";
    $<HTMLCalciteInputDatePickerElement>("#flt-to").value = "";
    await this.loadCascadingOptions();
    await this.applyFilters();
  }

  private async updateCount(): Promise<void> {
    const el = $<HTMLElement>("#filter-count");
    if (!this.optionsLayer) {
      el.textContent = "";
      return;
    }
    try {
      const n = await this.optionsLayer.queryFeatureCount({ where: buildWhere(this.optionsLayer, this.state) });
      el.textContent = t("filter.matches", { n });
    } catch {
      el.textContent = "";
    }
  }

  // ---------------------------------------------------------------- search by application code
  private wireSearch(): void {
    const input = $<HTMLCalciteInputElement>("#code-search");
    input.addEventListener("calciteInputChange", () => void this.searchCode((input.value ?? "").trim()));
    input.addEventListener("calciteInputInput", () => {
      input.status = "idle";
      input.validationMessage = "";
    });
  }

  private async searchCode(code: string): Promise<void> {
    const input = $<HTMLCalciteInputElement>("#code-search");
    if (!code) return;
    const escaped = code.toUpperCase().replaceAll("'", "''");
    // applications first (points, then polygons), then contracts
    const ordered = [
      ...this.layers.filter((l) => CONFIG.applicationsLayerPattern.test(l.url ?? "")),
      ...this.layers.filter((l) => !CONFIG.applicationsLayerPattern.test(l.url ?? "")),
    ];
    for (const layer of ordered) {
      const field = findField(layer, [CONFIG.searchField, "contractcode"]);
      if (!field) continue;
      try {
        const result = await layer.queryFeatures({
          where: `UPPER(${field}) = '${escaped}'`,
          outFields: ["*"],
          returnGeometry: true,
          num: 1,
          outSpatialReference: this.mapEl.view?.spatialReference ?? undefined,
        });
        const g = result.features[0];
        if (!g?.geometry) continue;
        g.layer = layer;
        layer.visible = true;
        await this.mapEl.goTo(g.geometry.type === "point" ? { target: g.geometry, scale: 20000 } : g.geometry);
        this.showFeature(g);
        await this.setHighlight(g);
        return;
      } catch {
        /* try the next layer */
      }
    }
    input.status = "invalid";
    input.validationMessage = t("search.notFound", { code });
  }

  // ---------------------------------------------------------------- feature info
  private showFeature(graphic: Graphic): void {
    this.featureEl.graphic = graphic;
    $<HTMLElement>("#info-empty").hidden = true;
    this.selectTab("overview");
  }

  private async onClick(event: Event): Promise<void> {
    const detail = (event as CustomEvent).detail as { x: number; y: number };
    if (!detail) return;
    try {
      const hit = await this.mapEl.hitTest(detail);
      const graphics = hit.results
        .filter((r) => r.type === "graphic" && (r as { graphic?: Graphic }).graphic?.layer)
        .map((r) => (r as { graphic: Graphic }).graphic);
      if (graphics.length === 0) return;
      // PES features first (applications, contracts, visits, photos), then anything else (forest areas, admin units...)
      const isPes = (g: Graphic) => CONFIG.filterableLayerPattern.test((g.layer as FeatureLayer)?.url ?? "");
      const hitGraphic = graphics.find(isPes) ?? graphics[0];
      // hit-test graphics only carry the attributes needed for drawing: fetch the complete feature so the
      // Arcade popups have every field they expect
      const graphic = (await this.fullFeature(hitGraphic)) ?? hitGraphic;
      this.showFeature(graphic);
      await this.setHighlight(graphic);
    } catch {
      /* ignore hit-test failures */
    }
  }

  private async fullFeature(graphic: Graphic): Promise<Graphic | null> {
    const layer = graphic.layer as FeatureLayer | null;
    if (!layer || layer.type !== "feature") return null;
    const oid = graphic.attributes?.[layer.objectIdField];
    if (oid === undefined || oid === null) return null;
    try {
      const result = await layer.queryFeatures({
        objectIds: [oid],
        outFields: ["*"],
        returnGeometry: true,
        outSpatialReference: this.mapEl.view?.spatialReference ?? undefined,
      });
      const full = result.features[0] ?? null;
      if (full) full.layer = layer;
      return full;
    } catch {
      return null;
    }
  }

  private async setHighlight(graphic: Graphic): Promise<void> {
    this.clearHighlight();
    const layer = graphic.layer;
    const view = this.mapEl.view;
    if (!layer || !view) return;
    const layerView = await view.whenLayerView(layer as Layer);
    if ("highlight" in layerView) {
      this.highlight = (layerView as unknown as { highlight(g: Graphic): { remove(): void } }).highlight(graphic);
    }
  }

  private clearHighlight(): void {
    this.highlight?.remove();
    this.highlight = null;
  }

  // ---------------------------------------------------------------- basemaps
  private wireBasemaps(): void {
    const control = $<HTMLCalciteSegmentedControlElement>("#basemap-select");
    control.innerHTML = "";
    const add = (value: string, key: string, checked = false) => {
      const item = document.createElement("calcite-segmented-control-item");
      item.value = value;
      item.checked = checked;
      item.setAttribute("data-i18n", key);
      item.textContent = t(key);
      control.appendChild(item);
    };
    add("webmap", "basemap.webmap", true);
    for (const b of CONFIG.basemaps) add(b.id, b.labelKey);
    control.addEventListener("calciteSegmentedControlChange", () => {
      const value = control.selectedItem?.value ?? "webmap";
      this.setBasemap(value);
    });
  }

  private setBasemap(id: string): void {
    const map = this.mapEl.map;
    if (!map) return;
    if (id === "webmap") {
      if (this.originalBasemap) map.basemap = this.originalBasemap;
      return;
    }
    const def = CONFIG.basemaps.find((b) => b.id === id);
    if (!def) return;
    const layer = def.url === "osm" ? new OpenStreetMapLayer() : new TileLayer({ url: def.url });
    map.basemap = new Basemap({ baseLayers: [layer], title: t(def.labelKey), id: def.id });
  }
}
