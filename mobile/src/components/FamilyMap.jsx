import React, { useMemo, useRef, useImperativeHandle, forwardRef } from 'react'
import { View, StyleSheet, useColorScheme } from 'react-native'
import { WebView } from 'react-native-webview'
import { useTheme, useThemeMode } from '../theme/ThemeContext'

const TILE_DARK = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
const TILE_LIGHT = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'

/**
 * FamilyMap — a self-contained Leaflet/OSM map rendered inside a WebView.
 *
 * Uses the SAME map system as the web dashboard (Leaflet + OSM tiles) but is
 * driven entirely by native props, so it works with NO Google Maps API key and
 * NO web deploy. It draws:
 *   - each safe-zone as a circle (with its radius + name)
 *   - each member as a marker (green = inside a zone, amber = outside)
 *   - a dashed line from every member to their NEAREST zone, labelled with the
 *     accurate distance (Haversine, metres/km)
 *
 * Props:
 *   members  : [{ id, name, latitude, longitude, battery_level, account_type }]
 *   zones    : [{ id, name, center_lat, center_lng, radius_meters }]
 *   me       : { latitude, longitude } | null   (the logged-in user's location)
 *   height   : number (default 220)
 *   interactive : boolean (default true) — allow pan/zoom
 */
export function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000
  const toRad = d => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

export function formatDistance(m) {
  if (m == null || isNaN(m)) return '—'
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`
}

function buildHtml(members, zones, me, pickMode, pick, isLight, zoomTopOffset) {
  const tileUrl = isLight ? TILE_LIGHT : TILE_DARK
  const bg = isLight ? '#eef2f0' : '#0b0f0d'
  const data = {
    members: (members || [])
      .filter(m => m.latitude != null && m.longitude != null)
      .map(m => ({
        name: m.name || '?',
        lat: Number(m.latitude),
        lng: Number(m.longitude),
        battery: m.battery_level ?? null,
        type: m.account_type || 'member',
      })),
    zones: (zones || [])
      .filter(z => z.center_lat != null && z.center_lng != null)
      .map(z => ({
        name: z.name || 'Zone',
        lat: Number(z.center_lat),
        lng: Number(z.center_lng),
        radius: Number(z.radius_meters) || 200,
      })),
    me: me && me.latitude != null ? { lat: Number(me.latitude), lng: Number(me.longitude) } : null,
    pickMode: !!pickMode,
    pick: pick && pick.latitude != null ? { lat: Number(pick.latitude), lng: Number(pick.longitude), radius: Number(pick.radius) || 200 } : null,
  }

  return `<!DOCTYPE html><html><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>
  html,body,#map{margin:0;padding:0;height:100%;width:100%;background:${bg}}
  .lbl{background:rgba(8,20,14,.9);color:#7CFFB2;border:1px solid #1f6e44;border-radius:6px;
       padding:1px 6px;font:600 11px system-ui;white-space:nowrap}
  .dlbl{background:rgba(8,20,14,.92);color:#FFD27C;border:1px solid #7a5a1e;border-radius:8px;
        padding:1px 7px;font:700 11px system-ui;white-space:nowrap}
  .plbl{background:rgba(6,16,28,.92);color:#67E8F9;border:1px solid #1e6a7a;border-radius:8px;
        padding:1px 7px;font:700 11px system-ui;white-space:nowrap}
  .leaflet-tile{filter:brightness(${isLight ? '1' : '.85'})}
  /* push the +/- zoom control down from the very top */
  .leaflet-top{top:${zoomTopOffset}px}
</style></head><body><div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
  var D = ${JSON.stringify(data)};
  function hav(a,b,c,d){var R=6371000,r=function(x){return x*Math.PI/180};
    var dLat=r(c-a),dLon=r(d-b);
    var s=Math.sin(dLat/2)*Math.sin(dLat/2)+Math.cos(r(a))*Math.cos(r(c))*Math.sin(dLon/2)*Math.sin(dLon/2);
    return 2*R*Math.asin(Math.sqrt(s));}
  function fmt(m){return m<1000?Math.round(m)+' m':(m/1000).toFixed(m<10000?2:1)+' km';}

  var map = L.map('map',{zoomControl:true,attributionControl:false}).setView([20.59,78.96],4);
  L.tileLayer('${tileUrl}',{maxZoom:20,subdomains:'abcd',attribution:'&copy; OpenStreetMap contributors &copy; CARTO'}).addTo(map);

  var bounds=[];

  // Zones
  D.zones.forEach(function(z){
    var c=L.circle([z.lat,z.lng],{radius:z.radius,color:'#00E676',weight:2,fillColor:'#00E676',fillOpacity:.10}).addTo(map);
    L.marker([z.lat,z.lng],{icon:L.divIcon({className:'',html:'<div class="lbl">🛡 '+z.name+'</div>',iconSize:[0,0]})}).addTo(map);
    bounds.push([z.lat,z.lng]);
  });

  // Identify the parent: the member flagged account_type==='parent'.
  // Fall back to the logged-in user's location ('me') if no parent member exists.
  var parent=null, parentName='Parent';
  D.members.forEach(function(m){ if(!parent && m.type==='parent'){ parent={lat:m.lat,lng:m.lng}; parentName=m.name; } });
  if(!parent && D.me){ parent={lat:D.me.lat,lng:D.me.lng}; parentName='You'; }

  // Self (only draw the generic self marker when it is not already the parent marker)
  if(D.me && !(parent && parent.lat===D.me.lat && parent.lng===D.me.lng)){
    L.circleMarker([D.me.lat,D.me.lng],{radius:7,color:'#fff',weight:2,fillColor:'#2196F3',fillOpacity:1}).addTo(map).bindTooltip('You',{permanent:false});
    bounds.push([D.me.lat,D.me.lng]);
  }

  // Parent marker — drawn distinctly (teal) so it stands out from children
  if(parent){
    L.circleMarker([parent.lat,parent.lng],{radius:9,color:'#fff',weight:2,fillColor:'#06B6D4',fillOpacity:1}).addTo(map)
      .bindTooltip('<b>👤 '+parentName+'</b>',{permanent:false});
    L.marker([parent.lat,parent.lng],{icon:L.divIcon({className:'',html:'<div class="plbl">👤 '+parentName+'</div>',iconSize:[0,0]})}).addTo(map);
    bounds.push([parent.lat,parent.lng]);
  }

  // Members + nearest-zone distance line + child→parent line
  D.members.forEach(function(m){
    var isParent = m.type==='parent';
    var nearest=null,nd=Infinity;
    D.zones.forEach(function(z){var d=hav(m.lat,m.lng,z.lat,z.lng); if(d<nd){nd=d;nearest=z;}});
    var inside = nearest && nd<=nearest.radius;
    var color = inside ? '#00E676' : '#FFB300';
    bounds.push([m.lat,m.lng]);

    // The parent member already has its own distinct marker drawn above.
    if(isParent) return;

    var pd = parent ? hav(m.lat,m.lng,parent.lat,parent.lng) : null;
    L.circleMarker([m.lat,m.lng],{radius:8,color:'#fff',weight:2,fillColor:color,fillOpacity:1}).addTo(map)
      .bindTooltip('<b>'+m.name+'</b>'+(m.battery!=null?(' · '+m.battery+'%'):'')
        +(nearest?('<br>'+fmt(nd)+' from '+nearest.name):'')
        +(pd!=null?('<br>'+fmt(pd)+' from '+parentName):''),{permanent:false});
    L.marker([m.lat,m.lng],{icon:L.divIcon({className:'',html:'<div class="lbl" style="margin-top:10px;color:'+color+';border-color:'+color+'">'+m.name+'</div>',iconSize:[0,0]})}).addTo(map);

    // Child → nearest-zone (existing dashed line + label)
    if(nearest){
      L.polyline([[m.lat,m.lng],[nearest.lat,nearest.lng]],{color:color,weight:1.5,dashArray:'5,6',opacity:.8}).addTo(map);
      var mid=[(m.lat+nearest.lat)/2,(m.lng+nearest.lng)/2];
      L.marker(mid,{icon:L.divIcon({className:'',html:'<div class="dlbl">'+fmt(nd)+'</div>',iconSize:[0,0]})}).addTo(map);
    }

    // Child → parent (second line, cyan, distinct style + label, offset to avoid overlap)
    if(parent && pd!=null){
      L.polyline([[m.lat,m.lng],[parent.lat,parent.lng]],{color:'#22D3EE',weight:1.5,dashArray:'2,5',opacity:.85}).addTo(map);
      var pmid=[(m.lat+parent.lat)/2,(m.lng+parent.lng)/2];
      L.marker(pmid,{icon:L.divIcon({className:'',html:'<div class="plbl" style="margin-top:14px">'+fmt(pd)+'</div>',iconSize:[0,0]})}).addTo(map);
    }
  });

  // ── Pick mode: tap the map to choose a location, post it back to RN ──────
  var pickCircle=null, pickMarker=null;
  function drawPick(lat,lng,radius){
    if(pickCircle){ map.removeLayer(pickCircle); pickCircle=null; }
    if(pickMarker){ map.removeLayer(pickMarker); pickMarker=null; }
    pickCircle=L.circle([lat,lng],{radius:radius||200,color:'#00E676',weight:2,fillColor:'#00E676',fillOpacity:.15}).addTo(map);
    pickMarker=L.marker([lat,lng],{icon:L.divIcon({className:'',html:'<div class="lbl">📍 Center</div>',iconSize:[0,0]})}).addTo(map);
  }
  if(D.pickMode){
    if(D.pick){ drawPick(D.pick.lat,D.pick.lng,D.pick.radius); bounds.push([D.pick.lat,D.pick.lng]); }
    map.on('click',function(e){
      drawPick(e.latlng.lat,e.latlng.lng,D.pick?D.pick.radius:200);
      if(window.ReactNativeWebView){
        window.ReactNativeWebView.postMessage(JSON.stringify({type:'pick',latitude:e.latlng.lat,longitude:e.latlng.lng}));
      }
    });
  }

  if(bounds.length){ map.fitBounds(bounds,{padding:[40,40],maxZoom:15}); }
  else if(D.me){ map.setView([D.me.lat,D.me.lng],14); }
  else { map.setView([20.59,78.96],4); }
  setTimeout(function(){map.invalidateSize();},250);
</script></body></html>`
}

const FamilyMap = forwardRef(function FamilyMap({
  members = [],
  zones = [],
  me = null,
  height = 220,
  interactive = true,
  pickMode = false,
  pick = null,
  onPickLocation,
  style,
  zoomTopOffset = 84,
}, ref) {
  const c = useTheme()
  const { mode } = useThemeMode()
  const systemScheme = useColorScheme()
  // Mirror ThemeContext.resolveColors so 'system' picks the OS scheme.
  const isLight = (mode === 'system' ? (systemScheme || 'dark') : mode) === 'light'
  const styles = useMemo(() => makeStyles(c, isLight), [c, isLight])
  const webRef = useRef(null)
  const html = useMemo(
    () => buildHtml(members, zones, me, pickMode, pick, isLight, zoomTopOffset),
    [members, zones, me, pickMode, pick, isLight, zoomTopOffset]
  )

  // ── Imperative pan/zoom handle ────────────────────────────────────────────
  // The Leaflet map lives inside the WebView (global `map` var). We drive it by
  // injecting a `map.setView([...], zoom)` call. MapScreen passes a region like
  // { latitude, longitude, latitudeDelta }; we derive a zoom from latitudeDelta
  // when present, otherwise keep the current zoom. No-op-safe until the map and
  // the WebView are both ready.
  useImperativeHandle(ref, () => ({
    animateToRegion(region) {
      if (!region || region.latitude == null || region.longitude == null) return
      if (!webRef.current) return
      const lat = Number(region.latitude)
      const lng = Number(region.longitude)
      if (isNaN(lat) || isNaN(lng)) return
      // Derive a Leaflet zoom from latitudeDelta (smaller delta → higher zoom).
      // log2(360 / delta) is the standard web-mercator mapping; clamp to 1..20.
      let zoomExpr = 'map.getZoom()'
      const delta = Number(region.latitudeDelta)
      if (!isNaN(delta) && delta > 0) {
        const z = Math.max(1, Math.min(20, Math.round(Math.log2(360 / delta))))
        zoomExpr = String(z)
      }
      const js =
        'try{ if(typeof map!=="undefined" && map){ map.flyTo([' +
        lat + ',' + lng + '], ' + zoomExpr + ', {duration:0.8}); } }catch(e){}; true;'
      webRef.current.injectJavaScript(js)
    },
  }), [])

  const handleMessage = (e) => {
    if (!onPickLocation) return
    try {
      const msg = JSON.parse(e.nativeEvent.data)
      if (msg && msg.type === 'pick' && msg.latitude != null && msg.longitude != null) {
        onPickLocation({ latitude: Number(msg.latitude), longitude: Number(msg.longitude) })
      }
    } catch (_) {}
  }
  return (
    <View style={[styles.wrap, style || { height }]}>
      <WebView
        ref={webRef}
        originWhitelist={['*']}
        source={{ html, baseUrl: 'https://localhost/' }}
        javaScriptEnabled
        domStorageEnabled
        mixedContentMode="always"
        scrollEnabled={interactive}
        nestedScrollEnabled
        androidLayerType="hardware"
        style={styles.web}
        onMessage={onPickLocation ? handleMessage : undefined}
        pointerEvents={interactive || pickMode ? 'auto' : 'none'}
      />
    </View>
  )
})

export default FamilyMap

const makeStyles = (c, isLight) => {
  const bg = isLight ? '#eef2f0' : '#0b0f0d'
  return StyleSheet.create({
    wrap: { borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: c.border, backgroundColor: bg },
    web: { flex: 1, backgroundColor: bg },
  })
}
