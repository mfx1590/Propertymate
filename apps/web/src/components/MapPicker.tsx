'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const pinIcon = L.divIcon({
  className: '',
  html: '<div style="width:18px;height:18px;border-radius:50% 50% 50% 0;background:#0d5f58;transform:rotate(-45deg);border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 18],
});

/** Click-to-pin location picker (wizard location step). */
export default function MapPicker({
  lat,
  lng,
  center,
  onChange,
}: {
  lat: number | null;
  lng: number | null;
  center: { lat: number; lng: number };
  onChange: (lat: number, lng: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current).setView([lat ?? center.lat, lng ?? center.lng], lat ? 14 : 10);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);
    if (lat && lng) markerRef.current = L.marker([lat, lng], { icon: pinIcon }).addTo(map);
    map.on('click', (e: L.LeafletMouseEvent) => {
      if (markerRef.current) markerRef.current.setLatLng(e.latlng);
      else markerRef.current = L.marker(e.latlng, { icon: pinIcon }).addTo(map);
      onChangeRef.current(Number(e.latlng.lat.toFixed(6)), Number(e.latlng.lng.toFixed(6)));
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // recenter when region changes
  useEffect(() => {
    if (mapRef.current && !lat) mapRef.current.setView([center.lat, center.lng], 11);
  }, [center.lat, center.lng, lat]);

  return <div ref={containerRef} className="h-80 w-full rounded-xl border border-gray-200" />;
}
