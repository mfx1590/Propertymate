'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { LatLng, PoiCategory, PoiFeature } from '../lib/listings';

const pinIcon = L.divIcon({
  className: '',
  html: '<div style="width:16px;height:16px;border-radius:50%;background:#0d5f58;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

/**
 * POIs are deliberately *not* the listing pin in another colour: a buyer
 * scanning a map has to tell "a property I could buy" from "the hospital"
 * at a glance, so they differ in shape and carry a glyph.
 */
const POI_STYLE: Record<PoiCategory, { glyph: string; color: string }> = {
  university: { glyph: '🎓', color: '#6d28d9' },
  beach: { glyph: '🏖', color: '#0284c7' },
  hospital: { glyph: '✚', color: '#dc2626' },
};

const poiIcon = (category: PoiCategory) => {
  const { glyph, color } = POI_STYLE[category];
  return L.divIcon({
    className: '',
    html:
      `<div style="width:22px;height:22px;border-radius:6px;background:white;border:2px solid ${color};` +
      `display:flex;align-items:center;justify-content:center;font-size:11px;line-height:1;` +
      `color:${color};box-shadow:0 1px 3px rgba(0,0,0,.35)">${glyph}</div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
};

/** The vertex handle you click to close the shape. */
const vertexIcon = L.divIcon({
  className: '',
  html: '<div style="width:10px;height:10px;border-radius:50%;background:white;border:2px solid #0d5f58"></div>',
  iconSize: [10, 10],
  iconAnchor: [5, 5],
});

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  label: string;
  href?: string;
}

/**
 * Read-only marker map (search results, listing detail), plus the §6.1
 * map-first extras: POI layers and a hand-drawn area filter.
 *
 * Drawing is done with plain Leaflet rather than `leaflet-draw`, which brings
 * an editing toolbar, its own icon sprites and a stylesheet for one gesture we
 * need: click to add a vertex, click the first one to close.
 */
export default function MapView({
  markers,
  center,
  zoom = 10,
  className = 'h-96 w-full rounded-xl border border-gray-200',
  pois = [],
  poiLabel,
  polygon = [],
  drawing = false,
  onPolygonChange,
  onFinishDraw,
}: {
  markers: MapMarker[];
  center: { lat: number; lng: number };
  zoom?: number;
  className?: string;
  pois?: PoiFeature[];
  /** Renders the POI popup, so category naming stays with the translations. */
  poiLabel?: (poi: PoiFeature) => string;
  polygon?: LatLng[];
  drawing?: boolean;
  onPolygonChange?: (points: LatLng[]) => void;
  /** Fired when the shape is closed on its first vertex. */
  onFinishDraw?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const poiLayerRef = useRef<L.LayerGroup | null>(null);
  const drawLayerRef = useRef<L.LayerGroup | null>(null);

  // Leaflet handlers are bound once against the map instance, so they would
  // capture the first render's props forever. The live values are read out of
  // refs instead — the classic stale-closure trap, and the same one that bit
  // the compare shortlist in step 15.
  const drawingRef = useRef(drawing);
  const polygonRef = useRef(polygon);
  const onChangeRef = useRef(onPolygonChange);
  const onFinishRef = useRef(onFinishDraw);
  drawingRef.current = drawing;
  polygonRef.current = polygon;
  onChangeRef.current = onPolygonChange;
  onFinishRef.current = onFinishDraw;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current).setView([center.lat, center.lng], zoom);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    poiLayerRef.current = L.layerGroup().addTo(map);
    drawLayerRef.current = L.layerGroup().addTo(map);

    map.on('click', (e: L.LeafletMouseEvent) => {
      if (!drawingRef.current) return;
      onChangeRef.current?.([...polygonRef.current, { lat: e.latlng.lat, lng: e.latlng.lng }]);
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      poiLayerRef.current = null;
      drawLayerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.clearLayers();
    for (const m of markers) {
      const marker = L.marker([m.lat, m.lng], { icon: pinIcon });
      marker.bindPopup(
        m.href ? `<a href="${m.href}" style="font-weight:600">${m.label}</a>` : m.label,
      );
      layer.addLayer(marker);
    }
    // Never yank the viewport while an area is being drawn or is in force: the
    // results change *because* of the shape on screen, and refitting to them
    // would drag the map out from under the hand drawing it.
    if (markers.length > 0 && mapRef.current && !drawing && polygon.length === 0) {
      mapRef.current.fitBounds(L.latLngBounds(markers.map((m) => [m.lat, m.lng])), {
        padding: [40, 40],
        maxZoom: 14,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markers]);

  useEffect(() => {
    const layer = poiLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    for (const poi of pois) {
      const [lng, lat] = poi.geometry.coordinates;
      const marker = L.marker([lat, lng], {
        icon: poiIcon(poi.properties.category),
        // Below the listing pins: a POI is context, never the thing being sold.
        zIndexOffset: -500,
        interactive: true,
      });
      marker.bindPopup(poiLabel ? poiLabel(poi) : poi.properties.name);
      layer.addLayer(marker);
    }
  }, [pois, poiLabel]);

  useEffect(() => {
    const layer = drawLayerRef.current;
    const map = mapRef.current;
    if (!layer || !map) return;
    layer.clearLayers();
    if (polygon.length === 0) {
      map.getContainer().style.cursor = drawing ? 'crosshair' : '';
      return;
    }

    const latlngs = polygon.map((p) => [p.lat, p.lng] as [number, number]);
    // Under three points there is no area yet — show the trace, not a shape
    // Leaflet would silently close for us.
    const shape =
      polygon.length >= 3
        ? L.polygon(latlngs, { color: '#0d5f58', weight: 2, fillOpacity: 0.08 })
        : L.polyline(latlngs, { color: '#0d5f58', weight: 2, dashArray: '4 4' });
    layer.addLayer(shape);

    if (drawing) {
      polygon.forEach((p, i) => {
        const handle = L.marker([p.lat, p.lng], { icon: vertexIcon });
        // Closing on the first vertex is the gesture every map tool uses, so
        // it is offered as well as the explicit Finish button.
        if (i === 0 && polygon.length >= 3) {
          handle.on('click', (e) => {
            // Without this the click falls through to the map handler and
            // adds a vertex on top of the one being clicked to close.
            L.DomEvent.stopPropagation(e);
            onFinishRef.current?.();
          });
        }
        layer.addLayer(handle);
      });
    }
    map.getContainer().style.cursor = drawing ? 'crosshair' : '';
  }, [polygon, drawing]);

  return <div ref={containerRef} className={className} />;
}
