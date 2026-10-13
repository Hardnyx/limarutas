# -*- coding: utf-8 -*-
# Extrae ambos sentidos de una ruta de WikiRoutes leyendo las capas de Leaflet
# Requisitos:
#   pip install "selenium==4.*" webdriver-manager beautifulsoup4 requests

import re, json, time, argparse
from pathlib import Path
from urllib.parse import urlparse, parse_qs, urljoin

import requests
from bs4 import BeautifulSoup

from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from webdriver_manager.chrome import ChromeDriverManager

DEFAULT_BASE = "https://wikiroutes.info"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
PAGE_TIMEOUT_S = 30

SEL_MAP_ANY = ".leaflet-pane, #map, .leaflet-container"
SEL_ROUTE_TITLE = "h1, .MEcFqLPlaQKg.RSZfWQHoH"
SEL_CITY_LABEL  = ".vGyZhDoaGCm.khuKVSRut"

def robots_allows(base: str, path: str) -> bool:
    try:
        r = requests.get(urljoin(base, "/robots.txt"), timeout=10)
        if r.status_code != 200: return True
        dis = []
        current = None
        for line in r.text.splitlines():
            line = line.strip()
            if not line or line.startswith("#"): continue
            if line.lower().startswith("user-agent:"):
                current = line.split(":", 1)[1].strip()
            elif line.lower().startswith("disallow:") and (current == "*" or current == None):
                dis.append(line.split(":", 1)[1].strip())
        return not any(path.startswith(d) for d in dis if d)
    except Exception:
        return True

def make_driver(headless=True, lang="es-ES"):
    opts = webdriver.ChromeOptions()
    if headless:
        opts.add_argument("--headless=new")
    opts.add_argument("--disable-gpu")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--window-size=1400,900")
    opts.add_argument(f"--user-agent={UA}")
    opts.add_argument(f"--lang={lang}")
    opts.add_experimental_option("excludeSwitches", ["enable-automation"])
    opts.add_experimental_option("useAutomationExtension", False)
    driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=opts)
    driver.set_page_load_timeout(PAGE_TIMEOUT_S)
    return driver

def wait_map_ready(driver):
    WebDriverWait(driver, PAGE_TIMEOUT_S).until(
        EC.presence_of_element_located((By.CSS_SELECTOR, SEL_MAP_ANY))
    )
    # Espera a que aparezca al menos 1 polyline en alguna instancia de Leaflet
    def has_lines(drv):
        js = """
        return (function(){
          var map=null;
          for (var k in window){
            try{
              var v=window[k];
              if (v && typeof v.eachLayer==='function' && typeof v.getCenter==='function'){
                map=v; break;
              }
            }catch(e){}
          }
          if(!map) return 0;
          var n=0;
          map.eachLayer(function(l){
            try{
              if (typeof L!=='undefined' && l instanceof L.Polyline && !(l instanceof L.Polygon)){ n++; }
            }catch(e){}
          });
          return n;
        })();
        """
        try:
            n = drv.execute_script(js)
            return int(n) > 0
        except Exception:
            return False
    WebDriverWait(driver, PAGE_TIMEOUT_S).until(lambda d: has_lines(d))

def leaflet_layers_signature(driver):
    """Devuelve una firma ligera del conjunto de polilíneas visibles para detectar cambios."""
    js = """
    return (function(){
      function flattenLatLngs(arr, out){
        if (!arr) return;
        if (Array.isArray(arr)){
          if (arr.length && arr[0] && typeof arr[0].lat==='number' && typeof arr[0].lng==='number'){
            for (var i=0;i<arr.length;i++) out.push(arr[i]);
            return;
          }
          for (var j=0;j<arr.length;j++) flattenLatLngs(arr[j], out);
        }
      }
      var map=null;
      for (var k in window){
        try{
          var v=window[k];
          if (v && typeof v.eachLayer==='function' && typeof v.getCenter==='function'){
            map=v; break;
          }
        }catch(e){}
      }
      if(!map) return "";
      var sigs=[];
      map.eachLayer(function(l){
        try{
          if (typeof L!=='undefined' && l instanceof L.Polyline && !(l instanceof L.Polygon)){
            var ll=[]; flattenLatLngs(l.getLatLngs(), ll);
            var n = ll.length;
            var a = ll[0], b = ll[n-1];
            var s = [n,
                     a ? a.lat.toFixed(6) : 0, a ? a.lng.toFixed(6) : 0,
                     b ? b.lat.toFixed(6) : 0, b ? b.lng.toFixed(6) : 0].join(',');
            sigs.push(s);
          }
        }catch(e){}
      });
      sigs.sort();
      return sigs.join('|');
    })();
    """
    try:
        return driver.execute_script(js) or ""
    except Exception:
        return ""

def wait_layers_changed(driver, previous_sig, timeout=15):
    t0 = time.time()
    while time.time() - t0 < timeout:
        sig = leaflet_layers_signature(driver)
        if sig and sig != previous_sig:
            return sig
        time.sleep(0.4)
    return previous_sig  # no cambió, devolvemos la anterior

def grab_leaflet_layers(driver):
    js = """
    return (function(){
      function convLatLng(ll){
        if (Array.isArray(ll)){
          if (ll.length && ll[0] && typeof ll[0].lat==='number' && typeof ll[0].lng==='number'){
            return ll.map(function(p){ return [p.lng, p.lat]; });
          }
          return ll.map(convLatLng).filter(function(a){ return a && a.length; });
        }
        if (ll && typeof ll.lat==='number' && typeof ll.lng==='number'){
          return [ll.lng, ll.lat];
        }
        return null;
      }
      var out = {lines:[], points:[]};
      var map=null;
      for (var k in window){
        try{
          var v=window[k];
          if (v && typeof v.eachLayer==='function' && typeof v.getCenter==='function'){
            map=v; break;
          }
        }catch(e){}
      }
      if(!map) return out;

      map.eachLayer(function(l){
        try{
          if (typeof L!=='undefined' && l instanceof L.Polyline && !(l instanceof L.Polygon)){
            var coords  = convLatLng(l.getLatLngs());
            if (!Array.isArray(coords) || coords.length===0) return;
            var segments = (coords.length && typeof coords[0][0] === 'number') ? [coords] : coords;
            out.lines.push({
              color: (l.options && (l.options.color || l.options.strokeColor)) || null,
              weight: (l.options && l.options.weight) || null,
              segments: segments
            });
          } else if (l && typeof l.getLatLng==='function'){
            var p = l.getLatLng();
            if (p && typeof p.lat==='number' && typeof p.lng==='number'){
              out.points.push([p.lng, p.lat]);
            }
          }
        }catch(e){}
      });
      return out;
    })();
    """
    return driver.execute_script(js)

def meta_from_html(html, url):
    soup = BeautifulSoup(html, "html.parser")
    title = soup.select_one(SEL_ROUTE_TITLE)
    city  = soup.select_one(SEL_CITY_LABEL)
    rid = None
    link = soup.find("link", rel="canonical")
    if link and link.get("href"):
        q = parse_qs(urlparse(link["href"]).query)
        rid = q.get("routes", [None])[0]
    return {
        "route_id": rid,
        "title": title.get_text(" ", strip=True) if title else None,
        "city": city.get_text(" ", strip=True) if city else None,
        "url": url
    }

def save_geojson_lines(out_dir: Path, lines, suffix: str = ""):
    feats = []
    for i, Lobj in enumerate(lines, 1):
      for seg in Lobj.get("segments", []):
        if not seg or len(seg) < 2: continue
        feats.append({
          "type":"Feature",
          "geometry":{"type":"LineString","coordinates":seg},
          "properties":{"color": Lobj.get("color"), "weight": Lobj.get("weight"), "idx": i}
        })
    fc = {"type":"FeatureCollection","features":feats}
    name = f"route_track{suffix}.geojson"
    (out_dir/name).write_text(json.dumps(fc, ensure_ascii=False), encoding="utf-8")

def save_geojson_points(out_dir: Path, pts, suffix: str = ""):
    feats = [{"type":"Feature","geometry":{"type":"Point","coordinates":c},"properties":{}} for c in pts]
    fc = {"type":"FeatureCollection","features":feats}
    name = f"stops{suffix}.geojson" if suffix else "stops_from_map.geojson"
    (out_dir/name).write_text(json.dumps(fc, ensure_ascii=False), encoding="utf-8")

def find_trip_toggles(driver):
    """Encuentra los botones de viaje ida/vuelta."""
    els = driver.find_elements(By.CSS_SELECTOR, '[data-tab-toggle^="trip"]')
    # Ordenar por trip-seq si existe
    def seq(el):
        try:
            v = el.get_attribute('trip-seq') or el.get_attribute('data-trip-seq') or ''
            m = re.search(r'\d+', v)
            return int(m.group(0)) if m else 9999
        except Exception:
            return 9999
    # Únicos por data-tab-toggle
    seen = set()
    ordered = []
    for el in sorted(els, key=seq):
        key = el.get_attribute('data-tab-toggle') or ''
        if key and key not in seen:
            seen.add(key)
            ordered.append(el)
    return ordered

def click_element_js(driver, el):
    driver.execute_script("arguments[0].scrollIntoView({block:'center'});", el)
    time.sleep(0.2)
    driver.execute_script("arguments[0].click();", el)

def scrape_route(url: str, out_root: Path, headless=True, driver=None) -> Path:
    base = f"{urlparse(url).scheme}://{urlparse(url).netloc}"
    if not robots_allows(base, urlparse(url).path):
        raise RuntimeError("Robots.txt no permite scrapear esta ruta")

    owns_driver = driver is None
    d = driver or make_driver(headless=headless)
    try:
        d.get(url)
        wait_map_ready(d)

        html = d.page_source
        meta = meta_from_html(html, url)
        rid = meta.get("route_id") or re.sub(r"[^A-Za-z0-9_-]+","_", meta.get("title") or "ruta")

        out_dir = out_root / f"route_{rid}"
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir/"route.html").write_text(html, encoding="utf-8", errors="ignore")
        (out_dir/"route.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

        # Acumuladores combinados
        all_lines = []
        all_points = []

        # Detectar toggles de viajes
        toggles = find_trip_toggles(d)
        if not toggles:
            # Un solo trazado (como antes)
            layers0 = grab_leaflet_layers(d)
            save_geojson_lines(out_dir, layers0.get("lines", []))
            if layers0.get("points"):
                save_geojson_points(out_dir, layers0["points"])
            all_lines.extend(layers0.get("lines", []))
            all_points.extend(layers0.get("points", []))
        else:
            # Recorremos todos los viajes (ida/vuelta)
            # 1) El primero ya está activo
            sig_prev = leaflet_layers_signature(d)
            layers1 = grab_leaflet_layers(d)
            save_geojson_lines(out_dir, layers1.get("lines", []), suffix="_trip1")
            if layers1.get("points"):
                save_geojson_points(out_dir, layers1["points"], suffix="_trip1")
            all_lines.extend(layers1.get("lines", []))
            all_points.extend(layers1.get("points", []))

            # 2) Para los siguientes, clic + espera a cambio y lee
            for idx in range(1, len(toggles)):
                try:
                    click_element_js(d, toggles[idx])
                except Exception:
                    # reintento simple
                    time.sleep(0.5)
                    click_element_js(d, toggles[idx])

                sig_prev = wait_layers_changed(d, sig_prev, timeout=15)
                layersN = grab_leaflet_layers(d)
                suffix = f"_trip{idx+1}"
                save_geojson_lines(out_dir, layersN.get("lines", []), suffix=suffix)
                if layersN.get("points"):
                    save_geojson_points(out_dir, layersN["points"], suffix=suffix)
                all_lines.extend(layersN.get("lines", []))
                all_points.extend(layersN.get("points", []))

            # Al final, escribe también los combinados estándar para tu front
            save_geojson_lines(out_dir, all_lines, suffix="")  # route_track.geojson
            if all_points:
                save_geojson_points(out_dir, all_points, suffix="")  # stops_from_map.geojson

        # Resumen
        summary = {
            "route_folder": str(out_dir),
            "trips_detected": max(1, len(toggles)),
            "line_segments_total": sum(len(x.get("segments", [])) for x in all_lines),
            "points_total": len(all_points)
        }
        (out_dir/"summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return out_dir
    finally:
        if owns_driver:
            d.quit()

# CLI
def main(argv=None):
    ap = argparse.ArgumentParser(description="Leaflet grabber para rutas de WikiRoutes (ambos sentidos)")
    ap.add_argument("--url", required=True)
    ap.add_argument("--out", default="data/raw/wikiroutes")
    ap.add_argument("--headless", type=int, default=0)
    args = ap.parse_args(argv)

    out_root = Path(args.out); out_root.mkdir(parents=True, exist_ok=True)
    scrape_route(args.url, out_root, headless=bool(args.headless))

if __name__ == "__main__":
    import sys
    main(sys.argv[1:])
