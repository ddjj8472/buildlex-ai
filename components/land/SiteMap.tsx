"use client";
// Site picker map (Leaflet, BSD-2). Base map: OpenStreetMap; with a V-World map key, the
// national base/satellite maps and WMS overlays (연속지적도, 용도지역·지구·구역, 개발제한구역).
import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";

export type MapPick = { lon: number; lat: number };
type Props = {
  mapKey?: string;
  parcel?: [number, number][][];
  marker?: MapPick;
  center?: MapPick;
  onPick: (p: MapPick) => void;
};

const SEOUL: MapPick = { lon: 126.978, lat: 37.5665 };
// V-World WMS layer ids (as used by the V-World 2D map and the ToJIDAEJANG QGIS plugin).
const OVERLAYS: [string, string][] = [
  ["lp_pa_cbnd_bubun", "연속지적도"],
  ["lt_c_uq111", "용도지역(도시지역)"],
  ["lt_c_uq112", "용도지구"],
  ["lt_c_uq113", "용도구역"],
  ["lt_c_ud801", "개발제한구역"],
];

export default function SiteMap({ mapKey, parcel, marker, center, onPick }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const lib = useRef<typeof Leaflet | null>(null);
  const shapes = useRef<Leaflet.LayerGroup | null>(null);
  const pickRef = useRef(onPick);
  // Leaflet loads asynchronously; `ready` re-runs the drawing effect once the map exists,
  // so a site chosen earlier is drawn when the map remounts (e.g. in another tab).
  const [ready, setReady] = useState(false);
  useEffect(() => { pickRef.current = onPick; }, [onPick]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const L = (await import("leaflet")).default;
      if (!alive || !host.current || map.current) return;
      lib.current = L;
      const m = L.map(host.current, { zoomControl: true, attributionControl: true }).setView([SEOUL.lat, SEOUL.lon], 12);
      const osm = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' });
      const bases: Record<string, Leaflet.TileLayer> = { "OpenStreetMap": osm };
      const overlays: Record<string, Leaflet.Layer> = {};
      if (mapKey) {
        const vw = (layer: string, ext: string) => L.tileLayer(`https://api.vworld.kr/req/wmts/1.0.0/${mapKey}/${layer}/{z}/{y}/{x}.${ext}`, { maxZoom: 19, attribution: '&copy; <a href="https://www.vworld.kr">V-World</a> 국토교통부' });
        bases["V-World 기본"] = vw("Base", "png");
        bases["V-World 위성"] = vw("Satellite", "jpeg");
        for (const [id, label] of OVERLAYS) {
          overlays[label] = L.tileLayer.wms("https://api.vworld.kr/req/wms", {
            layers: id, styles: id, format: "image/png", transparent: true, version: "1.3.0", maxZoom: 19, minZoom: 14, opacity: 0.6,
            key: mapKey, domain: window.location.origin,
          } as Leaflet.WMSOptions & Record<string, unknown>);
        }
      }
      (mapKey ? bases["V-World 기본"] : osm).addTo(m);
      if (mapKey) overlays["연속지적도"].addTo(m);
      L.control.layers(bases, overlays, { collapsed: true }).addTo(m);
      L.control.scale({ imperial: false }).addTo(m);
      shapes.current = L.layerGroup().addTo(m);
      m.on("click", e => pickRef.current({ lon: e.latlng.lng, lat: e.latlng.lat }));
      map.current = m;
      setReady(true);
      setTimeout(() => m.invalidateSize(), 50);
    })();
    return () => { alive = false; map.current?.remove(); map.current = null; setReady(false); };
  }, [mapKey]);

  useEffect(() => {
    const L = lib.current, m = map.current, g = shapes.current;
    if (!L || !m || !g) return;
    g.clearLayers();
    if (parcel?.length) {
      const poly = L.polygon(parcel.map(r => r.map(([x, y]) => [y, x] as [number, number])), { color: "#d93025", weight: 2.5, fillOpacity: 0.12 });
      g.addLayer(poly);
      m.fitBounds(poly.getBounds(), { maxZoom: 19, padding: [40, 40] });
    } else if (marker) {
      g.addLayer(L.circleMarker([marker.lat, marker.lon], { radius: 7, color: "#d93025", weight: 2, fillOpacity: 0.5 }));
      if (!m.getBounds().contains([marker.lat, marker.lon]) || m.getZoom() < 15) m.setView([marker.lat, marker.lon], Math.max(m.getZoom(), 17));
    }
  }, [parcel, marker?.lon, marker?.lat, ready]);

  useEffect(() => {
    if (center && map.current) map.current.setView([center.lat, center.lon], Math.max(map.current.getZoom(), 17));
  }, [center]);

  return <div ref={host} className="site-map" role="application" aria-label="대지 선택 지도 — 클릭하여 필지 선택" />;
}
