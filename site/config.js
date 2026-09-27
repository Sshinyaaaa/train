// Site configuration (PLAN.md §4e). Service URLs live here, not in the code, as the FOSSGIS terms
// recommend.
export const CONFIG = {
  // Operator contact email, shown in the footer. The FOSSGIS terms require an easily reachable
  // operator email on websites that use their routing server, so real walking routes stay OFF
  // (straight-line estimates are used) until this is set.
  contactEmail: null,

  // OSRM foot profile, FOSSGIS: https://routing.openstreetmap.de/about.html
  // Terms: https://www.fossgis.de/arbeitsgruppen/osm-server/nutzungsbedingungen/ (max 1 request/s, no bulk use)
  osrmFootUrl: "https://routing.openstreetmap.de/routed-foot",
  osrmMinIntervalMs: 1100,
  osrmTimeoutMs: 5000,
  walkCacheMs: 30 * 60 * 1000,       // also kept in sessionStorage, so reloads don't re-query
  osrmBackoffMs: 60 * 1000,          // after HTTP 429, no requests for this long (estimates instead)

  // Place confirmation map: Leaflet from cdnjs, OSM tiles (OSMF tile usage policy; attribution on map).
  leafletCss: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css",
  leafletJs: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js",
  tileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
};
