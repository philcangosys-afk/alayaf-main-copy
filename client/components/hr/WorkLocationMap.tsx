import { useEffect, useMemo, useState } from "react";
import L from "leaflet";
import {
  MapContainer,
  Marker,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";
import { Loader2, MapPin, Search } from "lucide-react";
import "leaflet/dist/leaflet.css";
import { useI18n } from "@/i18n";

const DEFAULT_CENTER: [number, number] = [21.4373, 40.5127];

const markerIcon = L.divIcon({
  className: "work-location-marker",
  html: '<svg viewBox="0 0 24 24" width="38" height="38" fill="#dc2626" stroke="white" stroke-width="1.5"><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="3" fill="white"/></svg>',
  iconSize: [38, 38],
  iconAnchor: [19, 38],
});

type SearchResult = {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  address?: {
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
  };
};

type WorkLocationMapProps = {
  latitude: string;
  longitude: string;
  initialSearch?: string;
  onLocationChange: (latitude: string, longitude: string) => void;
  onPlaceSelected?: (address: string, city: string) => void;
};

function MapController({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, Math.max(map.getZoom(), 15));
  }, [center, map]);
  return null;
}

function ClickHandler({
  onSelect,
}: {
  onSelect: (latitude: number, longitude: number) => void;
}) {
  useMapEvents({
    click: (event) => onSelect(event.latlng.lat, event.latlng.lng),
  });
  return null;
}

export default function WorkLocationMap({
  latitude,
  longitude,
  initialSearch = "",
  onLocationChange,
  onPlaceSelected,
}: WorkLocationMapProps) {
  const { t, direction } = useI18n();
  const [query, setQuery] = useState(initialSearch);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");

  const parsedLatitude = Number(latitude);
  const parsedLongitude = Number(longitude);
  const hasCoordinates =
    Number.isFinite(parsedLatitude) &&
    Number.isFinite(parsedLongitude) &&
    latitude.trim() !== "" &&
    longitude.trim() !== "";
  const center: [number, number] = hasCoordinates
    ? [parsedLatitude, parsedLongitude]
    : DEFAULT_CENTER;

  const markerHandlers = useMemo(
    () => ({
      dragend: (event: L.DragEndEvent) => {
        const marker = event.target as L.Marker;
        const position = marker.getLatLng();
        onLocationChange(
          position.lat.toFixed(7),
          position.lng.toFixed(7),
        );
      },
    }),
    [onLocationChange],
  );

  const selectCoordinates = (lat: number, lng: number) => {
    onLocationChange(lat.toFixed(7), lng.toFixed(7));
  };

  const searchPlaces = async () => {
    const value = query.trim();
    if (!value) return;
    setSearching(true);
    setSearchError("");
    try {
      const params = new URLSearchParams({
        q: value,
        format: "jsonv2",
        addressdetails: "1",
        limit: "5",
        countrycodes: "sa",
        "accept-language": "ar,en",
      });
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?${params.toString()}`,
        { headers: { Accept: "application/json" } },
      );
      if (!response.ok) throw new Error("SEARCH_FAILED");
      const data = (await response.json()) as SearchResult[];
      setResults(data);
      if (data.length === 0) setSearchError(t("لم يتم العثور على نتائج"));
    } catch {
      setResults([]);
      setSearchError(t("تعذر البحث عن المكان، حاول مرة أخرى"));
    } finally {
      setSearching(false);
    }
  };

  const chooseResult = (result: SearchResult) => {
    selectCoordinates(Number(result.lat), Number(result.lon));
    setQuery(result.display_name);
    setResults([]);
    const city =
      result.address?.city ??
      result.address?.town ??
      result.address?.village ??
      result.address?.municipality ??
      "";
    onPlaceSelected?.(result.display_name, city);
  };

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4" dir={direction}>
      <div>
        <h4 className="flex items-center gap-2 font-semibold text-slate-800">
          <MapPin className="h-4 w-4 text-red-600" />
          {t("تحديد موقع العمل على الخريطة")}
        </h4>
        <p className="mt-1 text-xs text-slate-500">
          {t("ابحث عن المكان، ثم اضغط على الخريطة أو حرّك الدبوس لتحديد الموقع بدقة.")}
        </p>
      </div>

      <div className="relative">
        <div className="flex gap-2">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void searchPlaces();
              }
            }}
            className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-400"
            placeholder={t("ابحث باسم المكان أو العنوان، مثال: حي الأندلس جدة")}
          />
          <button
            type="button"
            onClick={() => void searchPlaces()}
            disabled={searching}
            className="inline-flex items-center gap-2 rounded-lg bg-[#004e89] px-4 py-2 text-sm font-medium text-white hover:bg-[#003d6d] disabled:opacity-60"
          >
            {searching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            {t("بحث")}
          </button>
        </div>

        {results.length > 0 ? (
          <div className="absolute z-[1001] mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
            {results.map((result) => (
              <button
                key={result.place_id}
                type="button"
                onClick={() => chooseResult(result)}
                className="block w-full border-b border-slate-100 px-3 py-2 text-start text-sm text-slate-700 last:border-0 hover:bg-blue-50"
              >
                {result.display_name}
              </button>
            ))}
          </div>
        ) : null}
        {searchError ? (
          <p className="mt-2 text-xs text-red-600">{searchError}</p>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-300 bg-white">
        <MapContainer
          center={center}
          zoom={hasCoordinates ? 16 : 12}
          scrollWheelZoom
          className="h-[360px] w-full"
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <MapController center={center} />
          <ClickHandler onSelect={selectCoordinates} />
          {hasCoordinates ? (
            <Marker
              position={center}
              icon={markerIcon}
              draggable
              eventHandlers={markerHandlers}
            />
          ) : null}
        </MapContainer>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
          <span className="text-xs text-slate-500">{t("خط العرض")}</span>
          <p className="mt-1 font-mono text-sm font-semibold text-slate-800" dir="ltr">
            {latitude || "—"}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
          <span className="text-xs text-slate-500">{t("خط الطول")}</span>
          <p className="mt-1 font-mono text-sm font-semibold text-slate-800" dir="ltr">
            {longitude || "—"}
          </p>
        </div>
      </div>
    </div>
  );
}
