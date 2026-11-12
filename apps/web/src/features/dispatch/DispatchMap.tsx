import type { DispatchStop, GeoPoint } from "@meridian/contracts";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/utils";

const STATUS_COLORS: Record<string, string> = {
  UNSCHEDULED: "#94a3b8",
  SCHEDULED: "#22d3ee",
  DISPATCHED: "#fbbf24",
  IN_PROGRESS: "#8b5cf6",
  COMPLETED: "#34d399",
  CANCELED: "#fb7185",
  NO_SHOW: "#fb7185",
};

const FALLBACK_CENTER: L.LatLngTuple = [39.8283, -98.5795];
const TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors';

const UTC_TIME = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});

export const DISPATCH_STATUS_LEGEND = [
  { label: "Scheduled", color: "#22d3ee" },
  { label: "Dispatched", color: "#fbbf24" },
  { label: "In progress", color: "#8b5cf6" },
  { label: "Completed", color: "#34d399" },
  { label: "Problem", color: "#fb7185" },
] as const;

function utcTime(value: string | null): string {
  if (!value) return "Unscheduled";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unscheduled";
  return UTC_TIME.format(date);
}

/**
 * Builds the popup with DOM nodes instead of an HTML string. Customer names,
 * addresses and job titles are user-controlled, so innerHTML is never used.
 */
function buildPopup(stop: DispatchStop): HTMLElement {
  const root = document.createElement("div");
  root.className = "min-w-[190px] space-y-1 font-sans";

  const heading = document.createElement("p");
  heading.className = "text-xs font-semibold text-accent";
  heading.textContent = stop.number;
  root.append(heading);

  const title = document.createElement("p");
  title.className = "text-sm font-medium";
  title.textContent = stop.title;
  root.append(title);

  const customer = document.createElement("p");
  customer.className = "text-xs";
  customer.textContent = stop.customerName;
  root.append(customer);

  const address = document.createElement("p");
  address.className = "text-xs opacity-75";
  address.textContent = stop.address;
  root.append(address);

  const meta = document.createElement("p");
  meta.className = "text-xs opacity-75";
  const statusText = stop.status
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  meta.textContent = `${statusText} · ${utcTime(stop.scheduledStart)}`;
  root.append(meta);

  const link = document.createElement("a");
  link.href = `/app/schedule?job=${encodeURIComponent(stop.jobId)}`;
  link.className = "inline-block pt-1 text-xs font-medium underline";
  link.textContent = "Open in schedule";
  root.append(link);

  return root;
}

export interface DispatchMapViewProps {
  stops: DispatchStop[];
  depot: GeoPoint | null;
  center: GeoPoint | null;
  className?: string;
}

export function DispatchMapView({ stops, depot, center, className }: DispatchMapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const lastFitRef = useRef<string>("");
  const [tilesFailed, setTilesFailed] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const map = L.map(container, {
      center: center ? [center.latitude, center.longitude] : FALLBACK_CENTER,
      zoom: center ? 11 : 4,
      minZoom: 3,
      zoomControl: true,
      attributionControl: true,
      worldCopyJump: true,
    });
    mapRef.current = map;

    const tiles = L.tileLayer(TILE_URL, {
      maxZoom: 19,
      attribution: ATTRIBUTION,
    });
    tiles.on("tileerror", () => setTilesFailed(true));
    tiles.on("tileload", () => setTilesFailed(false));
    tiles.addTo(map);

    const layer = L.layerGroup().addTo(map);
    layerRef.current = layer;

    // Leaflet popups ship with a white chrome; keep them on-theme without a global stylesheet.
    map.on("popupopen", (event) => {
      const popup = event.popup.getElement();
      if (!popup) return;
      const wrapper = popup.querySelector<HTMLElement>(".leaflet-popup-content-wrapper");
      if (wrapper) {
        wrapper.style.background = "#111111";
        wrapper.style.color = "#f5f5f4";
        wrapper.style.border = "1px solid rgba(255, 255, 255, 0.08)";
        wrapper.style.boxShadow = "0 24px 80px -32px rgba(0, 0, 0, 0.8)";
      }
      const tip = popup.querySelector<HTMLElement>(".leaflet-popup-tip");
      if (tip) tip.style.background = "#111111";
      const close = popup.querySelector<HTMLElement>(".leaflet-popup-close-button");
      if (close) close.style.color = "#a8a29e";
    });

    requestAnimationFrame(() => {
      if (mapRef.current === map) map.invalidateSize();
    });

    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            if (mapRef.current === map) map.invalidateSize();
          });
    observer?.observe(container);

    return () => {
      observer?.disconnect();
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      lastFitRef.current = "";
    };
    // The map is created once; data updates are handled by the effect below.
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();

    for (const stop of stops) {
      if (!Number.isFinite(stop.latitude) || !Number.isFinite(stop.longitude)) continue;
      const marker = L.circleMarker([stop.latitude, stop.longitude], {
        radius: 9,
        color: "#0a0a0a",
        weight: 2,
        fillColor: STATUS_COLORS[stop.status] ?? "#94a3b8",
        fillOpacity: 1,
      });
      marker.bindPopup(buildPopup(stop), { maxWidth: 260 });
      marker.addTo(layer);
    }

    if (depot && Number.isFinite(depot.latitude) && Number.isFinite(depot.longitude)) {
      const depotMarker = L.circleMarker([depot.latitude, depot.longitude], {
        radius: 5,
        color: "#f5f5f4",
        weight: 2,
        fillColor: "#0a0a0a",
        fillOpacity: 1,
      });
      const label = document.createElement("span");
      label.textContent = "Depot";
      depotMarker.bindPopup(label);
      depotMarker.addTo(layer);
    }

    const points: L.LatLngTuple[] = [];
    for (const stop of stops) {
      if (Number.isFinite(stop.latitude) && Number.isFinite(stop.longitude)) {
        points.push([stop.latitude, stop.longitude]);
      }
    }
    if (depot && Number.isFinite(depot.latitude) && Number.isFinite(depot.longitude)) {
      points.push([depot.latitude, depot.longitude]);
    }

    const signature = `${points.map((point) => point.join(",")).join("|")}::${
      center ? `${center.latitude},${center.longitude}` : ""
    }`;
    if (signature === lastFitRef.current) return;
    lastFitRef.current = signature;

    requestAnimationFrame(() => {
      if (mapRef.current !== map) return;
      map.invalidateSize();
      if (points.length > 0) {
        map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 14 });
      } else if (center) {
        map.setView([center.latitude, center.longitude], 11);
      } else {
        map.setView(FALLBACK_CENTER, 4);
      }
    });
  }, [stops, depot, center]);

  return (
    <div className={cn("relative overflow-hidden rounded-card border border-border bg-surface-2", className)}>
      <div
        ref={containerRef}
        role="region"
        aria-label="Dispatch map"
        className="h-[320px] w-full sm:h-[420px]"
        style={{ isolation: "isolate", backgroundColor: "#161616" }}
      />
      {tilesFailed ? (
        <p className="pointer-events-none absolute bottom-2 left-2 z-[1000] rounded-full border border-warning/35 bg-bg/90 px-2.5 py-1 text-[10px] font-medium text-warning">
          Map tiles unavailable — stops still show
        </p>
      ) : null}
    </div>
  );
}
