/* Парцели Варна — every plot in the city: owner, ОУП zone, restrictions, how built-up it is. */
(() => {
  // ---------- Definitions ----------
  // Owner categories come from analyze_all.py (owner_category); statuses are checked in this order there.
  const OWNER = {
    mun_private: { label: 'Община — частна собственост', short: 'Община (частна)', desc: 'Може да се продаде или да се учреди право на строеж', color: '#0d9488', on: true },
    mun_public: { label: 'Община — публична собственост', short: 'Община (публична)', desc: 'Не може да се продава: улици, паркове, училища…', color: '#5eead4', on: false },
    state: { label: 'Държава', short: 'Държава', desc: 'Държавна собственост и институции', color: '#7c3aed', on: true },
    company: { label: 'Фирма', short: 'Фирма', desc: 'Юридически лица и еднолични търговци', color: '#ea580c', on: true },
    mixed: { label: 'Фирма + физически лица', short: 'Смесена', desc: 'Съсобственост на фирми и граждани', color: '#ca8a04', on: true },
    person: { label: 'Физически лица', short: 'Физически лица', desc: 'Показва се само броят, без имена', color: '#94a3b8', on: false },
    unknown: { label: 'Няма данни', short: 'Няма данни', desc: 'Без записан собственик в КАИС', color: '#d1d5db', on: false },
  };
  const STATUS = {
    free: { label: 'Незастроен', desc: 'Без сгради; ОУП допуска жилища или курортно строителство; без ограничения', color: '#16a34a', on: true },
    partial: { label: 'Частично застроен', desc: 'Има сгради, но покриват под 15% от терена', color: '#84cc16', on: true },
    estate: { label: 'Свободен, но в жилищен комплекс', desc: 'Вероятно междублоково пространство', color: '#f59e0b', on: false },
    built: { label: 'Застроен', desc: 'Сгради покриват 15% или повече', color: '#9ca3af', on: false },
    public: { label: 'Улица, парк или обществен обект', desc: 'Така е записан в кадастъра', color: '#60a5fa', on: false },
    nonres: { label: 'Зона без жилищно строителство', desc: 'Зелена, производствена, обществена, транспортна и др. по ОУП', color: '#6366f1', on: false },
    restricted: { label: 'С ограничение', desc: 'Зона А по ЗУЧК, активно свлачище, забрана, Натура 2000', color: '#ef4444', on: false },
    outside: { label: 'Извън урбанизирана територия', desc: 'Земеделска, горска и др. земя', color: '#a8a29e', on: false },
  };
  const DEFAULTS = {
    owners: Object.keys(OWNER).filter((k) => OWNER[k].on),
    statuses: Object.keys(STATUS).filter((k) => STATUS[k].on),
    minArea: '500', district: '', zone: '', sort: 'area', colorBy: 'owner',
  };
  const ZONE_COLORS = {
    residential: '#c8a27a', central: '#b07fc4', mixed: '#ce93d8', public: '#e57373',
    production: '#9575cd', resort: '#ffb74d', sport: '#4fc3f7', agricultural: '#fff176',
    infrastructure: '#bdbdbd', special: '#bdbdbd', green: '#81c784', forest: '#388e3c', protected: '#4db6ac',
  };
  const FLAGS = [
    ['zone_a', 'Зона А (ЗУЧК)'], ['zone_b', 'Зона Б (ЗУЧК)', 'warn'], ['landslide', 'Активно свлачище'],
    ['ban', 'Строителна забрана'], ['natura', 'Натура 2000'], ['protected', 'Защитена територия'],
    ['archaeology', 'Археология', 'warn'], ['geo_warning', 'Свлачищен район: нужно инж.-геоложко проучване', 'warn'],
  ];
  const WMS = 'https://gis.varnamap.bg/geoserver/wms';
  const POLY_ZOOM = 15;
  const LIST_LIMIT = 300;
  const MAX_DOTS = 70000;
  const MAX_SELECT_ALL = 2000;
  const KEY = { favs: 'varna-plots:favs:v1', filters: 'varna-plots:filters:v1' };

  // ---------- Helpers ----------
  const $ = (s) => document.querySelector(s);
  const nf = new Intl.NumberFormat('bg-BG', { maximumFractionDigits: 0 });
  const num = (v, unit = '') => (v === null || v === undefined || v === '' ? '—' : nf.format(v) + unit);
  const ha = (m2) => (m2 / 10000).toLocaleString('bg-BG', { maximumFractionDigits: 1 });
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const load = (name) => fetch(`data/${name}`).then((r) => {
    if (!r.ok) throw new Error(`${name}: ${r.status}`);
    return r.json();
  });
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: keep in memory only */ }
    },
  };
  const isPhone = () => window.matchMedia('(max-width: 699px)').matches;
  const isDark = () => {
    const t = document.documentElement.dataset.theme;
    return t ? t === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  };
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  // 10135.5501.356 -> city code dimmed, cadastral region, plot number in bold (as on a КККР sheet).
  function cad(id) {
    const [e, r, n] = String(id).split('.');
    if (!n) return `<span class="cad">${esc(id)}</span>`;
    return `<span class="cad"><span class="e">${e}</span><span class="d">.</span><span class="r">${r}</span><span class="d">.</span><span class="n">${n}</span></span>`;
  }
  const ICON = {
    layers: '<svg viewBox="0 0 24 24"><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/></svg>',
    reset: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/></svg>',
    locate: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>',
    rect: '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="1.5" stroke-dasharray="3 2.5"/></svg>',
    mark: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8.5 12 2.5 2.5 4.5-5"/></svg>',
    fit: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
    star: '<svg viewBox="0 0 24 24"><path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9L12 3.5Z"/></svg>',
    check: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8.5 12 2.5 2.5 4.5-5"/></svg>',
    sun: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/></svg>',
    moon: '<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/></svg>',
  };
  const canHover = window.matchMedia('(hover: hover)').matches;

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  // Search normalisation: case, quotes and legal forms don't matter; Latin is read as Cyrillic.
  const LEGAL = new Set(['еоод', 'оод', 'ад', 'еад', 'ет', 'кд', 'кда', 'сд', 'адсиц', 'дзз', 'дззд', 'ltd', 'llc', 'gmbh']);
  const LAT = [['sht', 'щ'], ['sh', 'ш'], ['ch', 'ч'], ['zh', 'ж'], ['ts', 'ц'], ['yu', 'ю'], ['ya', 'я'], ['a', 'а'], ['b', 'б'],
    ['v', 'в'], ['g', 'г'], ['d', 'д'], ['e', 'е'], ['z', 'з'], ['i', 'и'], ['j', 'й'], ['k', 'к'], ['l', 'л'], ['m', 'м'], ['n', 'н'],
    ['o', 'о'], ['p', 'п'], ['r', 'р'], ['s', 'с'], ['t', 'т'], ['u', 'у'], ['f', 'ф'], ['h', 'х'], ['c', 'ц'], ['w', 'в'], ['y', 'й'],
    ['q', 'к'], ['x', 'кс']];
  function translit(s) {
    let out = '';
    for (let i = 0; i < s.length;) {
      const hit = LAT.find(([l]) => s.startsWith(l, i));
      if (hit) { out += hit[1]; i += hit[0].length; } else { out += s[i]; i += 1; }
    }
    return out;
  }
  function norm(s, keepLegal = false) {
    const words = translit(String(s || '').toLowerCase()).replace(/[^0-9a-zа-яё]+/g, ' ').trim().split(' ');
    return words.filter((w) => w && (keepLegal || !LEGAL.has(w))).join(' ');
  }

  // ---------- State ----------
  const saved = store.get(KEY.filters, null);
  const state = {
    rows: [], byId: new Map(), rules: {}, entities: [], entitiesByPlot: new Map(),
    matched: [], matchSet: new Set(),
    owners: new Set(saved?.owners || DEFAULTS.owners),
    statuses: new Set(saved?.statuses || DEFAULTS.statuses),
    entity: null,          // company chosen from search or the owners list; narrows the filtered plots
    text: '',              // free-text search over owner names; narrows the filtered plots too
    searchAll: false,      // show all the company's / search's plots, ignoring the filters
    scope: { total: 0, inFilters: 0 },
    current: null,         // plot open in the detail view
    pendingDetail: null,
    sel: new Set(),
    favs: new Map(Object.entries(store.get(KEY.favs, {}))),
    markMode: false,
    tab: 'filters',
    events: [], signalsByPlot: new Map(), mode: null, feedUpdated: '',
    changePeriods: [], changeEvents: [], changesByPlot: new Map(), changePeriod: '',
    changeTypes: new Set(['to_entity', 'to_person', 'swap', 'coowner', 'category', 'new', 'removed']),
    auctionKinds: new Set(['plots', 'land']),
    pupTypes: new Set(['pup_request', 'pup_approved']),
  };

  // ---------- Map ----------
  const HOME = { center: [43.215, 27.91], zoom: 13 };
  const map = L.map('map', { preferCanvas: true, zoomControl: !isPhone(), tap: false }).setView(HOME.center, HOME.zoom);
  // "Изчистена": OpenStreetMap muted with a CSS filter (grey in light mode, inverted in dark) so the data stands out.
  const clean = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 20, maxNativeZoom: 19, attribution: '© OpenStreetMap', className: 'tiles-clean',
  });
  const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 20, maxNativeZoom: 19, attribution: '© OpenStreetMap',
  }).addTo(map);
  const BASES = { clean, osm, sat: null };
  const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 20, maxNativeZoom: 19, attribution: 'Imagery © Esri',
  });
  BASES.sat = sat;

  // Only the plots pane takes clicks; zones, restrictions and cadastre tiles let them through.
  function makePane(name, z, interactive) {
    const p = map.createPane(name);
    p.style.zIndex = z;
    if (!interactive) p.style.pointerEvents = 'none';
  }
  makePane('zones', 405, false);
  makePane('restrictions', 410, false);
  makePane('cadastre', 415, false);
  makePane('plots', 430, true);
  const zonesCanvas = L.canvas({ pane: 'zones', padding: 0.5 });
  const restrCanvas = L.canvas({ pane: 'restrictions', padding: 0.5 });
  // Small padding keeps the canvas under Safari's size limit on large Retina screens (it draws nothing above it).
  const plotsCanvas = L.canvas({ pane: 'plots', padding: 0.2, tolerance: canHover ? 2 : 8 });

  const wms = (layers) => L.tileLayer.wms(WMS, {
    layers, format: 'image/png', transparent: true, version: '1.1.1', minZoom: 15, maxZoom: 20,
    attribution: 'varnamap.bg', pane: 'cadastre',
  });
  const cadastreWms = wms('varnamap:Cadastre202502_wgs');
  const buildingsWms = wms('varnamap:Sgradi202502_wgs');

  const zones = L.geoJSON(null, {
    pane: 'zones', renderer: zonesCanvas, interactive: false,
    style: (f) => ({
      color: '#8a8a8a', weight: 0.4, fillOpacity: 0.3,
      fillColor: ZONE_COLORS[state.rules[f.properties.zone]?.group] || '#e0e0e0',
    }),
  });
  const overlay = (style) => L.geoJSON(null, { pane: 'restrictions', renderer: restrCanvas, interactive: false, style });
  const restrictionParts = {
    zone_a: overlay({ color: '#c62828', weight: 1.5, fillColor: '#e53935', fillOpacity: 0.15 }),
    zone_b: overlay({ color: '#ef6c00', weight: 1.5, dashArray: '6 4', fill: false }),
    geology_a: overlay({ color: '#4e342e', weight: 1, fillColor: '#6d4c41', fillOpacity: 0.2 }),
    landslides: overlay({ color: '#3e2723', weight: 1, fillColor: '#5d4037', fillOpacity: 0.35 }),
    ban: overlay({ color: '#000', weight: 1.5, fillColor: '#212121', fillOpacity: 0.25 }),
    natura: overlay({ color: '#2e7d32', weight: 1.5, dashArray: '2 4', fill: false }),
    protected: overlay({ color: '#00695c', weight: 1.5, fill: false }),
  };
  const restrictions = L.layerGroup(Object.values(restrictionParts));

  // Plot outlines (zoom >= POLY_ZOOM, loaded per grid cell) and dots (city scale) share one canvas.
  let loadingCell = null;   // set while a cell's features are added, so each outline knows its cell
  const cellLayers = new Map();
  const plots = L.geoJSON(null, {
    pane: 'plots', renderer: plotsCanvas,
    style: (f) => polyStyle(f.properties.id),
    onEachFeature: (f, layer) => {
      plotLayers.set(f.properties.id, layer);
      layer._cell = loadingCell;
      if (loadingCell) cellLayers.get(loadingCell).push(layer);
      layer.on('click', (e) => onPlotClick(f.properties.id, e.originalEvent));
      if (canHover) layer.bindTooltip(() => `${f.properties.id} · ${esc(state.byId.get(f.properties.id)?.owner || '')}`, { sticky: true });
    },
  });
  // A plot's details (address, zone limits, restrictions…) are kept apart from the outlines and
  // downloaded per cell only when a plot in it is opened.
  const facts = new Map();   // cell -> {id: properties}, or a pending Promise
  function factsOf(id) {
    const cell = plotLayers.get(id)?._cell;
    if (!cell) return null;
    const f = facts.get(cell);
    if (f && !(f instanceof Promise)) return f[id] || {};
    if (!f) {
      facts.set(cell, load(`facts/${cell}.json`)
        .then((d) => { facts.set(cell, d); if (state.current) renderDetail(); })
        .catch(() => facts.delete(cell)));
    }
    return null;
  }
  const plotLayers = new Map();
  const grid = { cell: 0.01, cells: {}, loaded: new Set() };
  const DotLayer = L.Layer.extend({
    initialize() { this._rows = []; this._hit = new Map(); },
    onAdd(m) {
      this._canvas = L.DomUtil.create('canvas', 'dot-layer');
      this._canvas.style.position = 'absolute';
      this._canvas.style.pointerEvents = 'none';
      m.getPane('plots').appendChild(this._canvas);
      this._tip = L.tooltip({ direction: 'top', offset: [0, -6] });
      m.on('moveend resize', this._reset, this);
      m.on('zoomstart', this._hide, this);
      m.on('click', this._click, this);
      if (canHover) m.on('mousemove', this._move, this);
      this._reset();
    },
    onRemove(m) {
      L.DomUtil.remove(this._canvas);
      m.off('moveend resize', this._reset, this);
      m.off('zoomstart', this._hide, this);
      m.off('click', this._click, this);
      m.off('mousemove', this._move, this);
      m.closeTooltip(this._tip);
      m.getContainer().style.cursor = '';
    },
    setRows(rows) { this._rows = rows; if (this._map) this._draw(); },
    _hide() { this._canvas.style.visibility = 'hidden'; },
    _reset() {
      const m = this._map;
      const size = m.getSize();
      const dpr = window.devicePixelRatio || 1;
      L.DomUtil.setPosition(this._canvas, m.containerPointToLayerPoint([0, 0]));
      this._canvas.width = size.x * dpr;
      this._canvas.height = size.y * dpr;
      this._canvas.style.width = size.x + 'px';
      this._canvas.style.height = size.y + 'px';
      this._canvas.style.visibility = '';
      this._draw();
    },
    _draw() {
      const m = this._map;
      const ctx = this._canvas.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      const size = m.getSize();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size.x, size.y);
      this._hit = new Map();
      const B = 24;
      // Draw big plots first so small ones stay visible on top.
      const rows = [...this._rows].sort((a, b) => b.area - a.area);
      for (const r of rows) {
        const p = m.latLngToContainerPoint([r.lat, r.lon]);
        if (p.x < -10 || p.y < -10 || p.x > size.x + 10 || p.y > size.y + 10) continue;
        const fav = state.favs.has(r.id);
        const sel = state.sel.has(r.id);
        const radius = Math.max(3, Math.min(9, Math.sqrt(r.area) / 12)) + (fav || sel ? 2 : 0);
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx.globalAlpha = state.matchSet.has(r.id) ? 0.85 : 0.4;
        ctx.fillStyle = colorOf(r);
        ctx.fill();
        ctx.globalAlpha = 0.95;
        ctx.lineWidth = sel || fav ? 2.5 : 0.8;
        ctx.strokeStyle = sel ? cssVar('--accent') : fav ? cssVar('--fav') : (isDark() ? '#0e1418' : '#ffffff');
        ctx.stroke();
        const key = `${Math.floor(p.x / B)},${Math.floor(p.y / B)}`;
        if (!this._hit.has(key)) this._hit.set(key, []);
        this._hit.get(key).push([p.x, p.y, radius, r]);
      }
      ctx.globalAlpha = 1;
    },
    _find(pt) {
      const B = 24;
      const tol = canHover ? 2 : 8;
      let best = null, bestD = Infinity;
      for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
          for (const [x, y, rad, r] of this._hit.get(`${Math.floor(pt.x / B) + i},${Math.floor(pt.y / B) + j}`) || []) {
            const d = Math.hypot(x - pt.x, y - pt.y);
            if (d <= rad + tol && d < bestD) { best = r; bestD = d; }
          }
        }
      }
      return best;
    },
    _click(e) {
      const r = this._find(e.containerPoint);
      if (r) onPlotClick(r.id, e.originalEvent);
    },
    _move(e) {
      const r = this._find(e.containerPoint);
      const m = this._map;
      m.getContainer().style.cursor = r ? 'pointer' : '';
      if (r) {
        this._tip.setLatLng([r.lat, r.lon]).setContent(`${r.id} · ${num(r.area, ' м²')}<br>${esc(r.owner)}`);
        if (!m.hasLayer(this._tip)) m.openTooltip(this._tip);
      } else if (m.hasLayer(this._tip)) m.closeTooltip(this._tip);
    },
  });
  const dots = new DotLayer();
  window.__parceli = { map, plots, plotLayers, grid, state };  // for debugging in the console

  const OVERLAYS = { zones, restrictions, buildings: buildingsWms, cadastre: cadastreWms };
  L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);

  // Tool buttons: locate me, rectangle select, mark mode, fit results.
  const tools = L.control({ position: 'topright' });
  tools.onAdd = () => {
    const d = L.DomUtil.create('div', 'map-tools leaflet-control');
    d.innerHTML = `
      <button type="button" id="tool-layers" title="Слоеве на картата" aria-label="Слоеве на картата">${ICON.layers}</button>
      <button type="button" id="tool-locate" title="Къде съм" aria-label="Къде съм">${ICON.locate}</button>
      <button type="button" id="tool-rect" title="Избери с правоъгълник" aria-label="Избери с правоъгълник">${ICON.rect}</button>
      <button type="button" id="tool-mark" title="Маркиране с докосване" aria-label="Маркиране с докосване">${ICON.mark}</button>
      <button type="button" id="tool-fit" title="Покажи всички резултати" aria-label="Покажи всички резултати">${ICON.fit}</button>
      <button type="button" id="tool-reset" title="Начало: изчисти търсенето и избора" aria-label="Начало: изчисти търсенето и избора">${ICON.reset}</button>
      <button type="button" id="tool-theme"></button>`;
    L.DomEvent.disableClickPropagation(d);
    return d;
  };
  tools.addTo(map);
  const banner = L.DomUtil.create('div', 'mode-banner', map.getContainer());
  banner.hidden = true;
  banner.innerHTML = '<span class="mb-text"></span><button type="button" class="mb-done">Готово</button>';
  L.DomEvent.disableClickPropagation(banner);
  const legend = L.control({ position: 'bottomright' });
  legend.onAdd = () => {
    const d = L.DomUtil.create('div', 'legend closed');
    L.DomEvent.disableClickPropagation(d);
    return d;
  };
  legend.addTo(map);

  const colorBy = () => $('#color-by').value;
  const colorMode = () => (state.entity ? 'status' : colorBy());
  const colorOf = (r) => (colorMode() === 'owner' ? OWNER[r.cat] : STATUS[r.status])?.color || '#999';

  function polyStyle(id) {
    const r = state.byId.get(id);
    if (!r) return { color: '#9ca3af', weight: 0.5, fillOpacity: 0 };
    const c = colorOf(r);
    const shown = state.matchSet.has(id);
    const s = shown
      ? { color: c, weight: 1.2, opacity: 1, fill: true, fillColor: c, fillOpacity: 0.45, dashArray: null }
      : { color: '#6b7280', weight: 0.9, opacity: 0.75, fill: true, fillColor: '#6b7280', fillOpacity: 0.04, dashArray: null };
    // Search hits stand out even when their category colour is grey (e.g. built plots).
    if (shown && (state.entity || state.text)) Object.assign(s, { color: '#101820', weight: 2.5, fillOpacity: 0.6 });
    if (state.favs.has(id)) Object.assign(s, { color: cssVar('--fav'), weight: 3, opacity: 1 });
    if (state.sel.has(id)) Object.assign(s, { color: cssVar('--accent'), weight: 3.5, opacity: 1, fillOpacity: Math.max(s.fillOpacity, 0.3), fillColor: shown ? c : cssVar('--accent') });
    if (id === state.current) Object.assign(s, { color: cssVar('--reg'), weight: 3.5, opacity: 1, dashArray: '9 6', fillOpacity: 0.55, fillColor: c });
    return s;
  }
  function restyle(ids) {
    for (const id of ids) {
      const l = plotLayers.get(id);
      if (l) { l.setStyle(polyStyle(id)); if (id === state.current || state.sel.has(id)) l.bringToFront(); }
    }
  }

  function renderLegend() {
    const el = document.querySelector('.legend');
    const src = colorMode() === 'owner' ? OWNER : STATUS;
    const closed = el.classList.contains('closed');
    el.innerHTML = `<button type="button" class="lg-toggle" aria-expanded="${!closed}">
        <span>${colorMode() === 'owner' ? 'Собственик' : 'Състояние'}</span>
        <span class="lg-dots">${Object.values(src).map((s) => `<i style="background:${s.color}"></i>`).join('')}</span>
        <span>${closed ? '▸' : '▾'}</span></button>
      <div class="lg-body">${Object.values(src).map((s) => `<div><i style="background:${s.color}"></i>${s.short || s.label}</div>`).join('')}
      <div><i style="border:2.5px solid var(--fav)"></i>Любим</div><div><i style="border:2.5px solid var(--accent)"></i>Избран</div>
      <div><i style="border:2px dashed var(--reg)"></i>Отворен парцел</div>
      ${map.getZoom() >= POLY_ZOOM ? '<div><i style="border:1px solid #6b7280"></i>Извън филтъра</div>' : ''}</div>`;
    el.querySelector('.lg-toggle').onclick = () => { el.classList.toggle('closed'); renderLegend(); };
  }

  // Outlines are drawn only when the view needs few enough cells: on a large screen at zoom 15
  // that would be tens of thousands of outlines, which makes the map slow.
  const MAX_POLY_CELLS = 24;
  function visibleCellCount() {
    const b = map.getBounds(), c = grid.cell;
    let n = 0;
    for (let i = Math.floor(b.getWest() / c); i <= Math.floor(b.getEast() / c); i++)
      for (let j = Math.floor(b.getSouth() / c); j <= Math.floor(b.getNorth() / c); j++) if (grid.cells[`${i}_${j}`]) n++;
    return n;
  }
  const zoomHint = L.DomUtil.create('div', 'zoom-hint', map.getContainer());
  zoomHint.hidden = true;
  zoomHint.textContent = 'Приближете, за да видите границите на парцелите';
  function syncZoomLayers() {
    const crowded = map.getZoom() >= POLY_ZOOM && visibleCellCount() > MAX_POLY_CELLS;
    zoomHint.hidden = !crowded;
    if (map.getZoom() >= POLY_ZOOM && !crowded) {
      if (map.hasLayer(dots)) map.removeLayer(dots);
      if (!map.hasLayer(plots)) plots.addTo(map);
      loadVisibleCells();
    } else {
      if (map.hasLayer(plots)) map.removeLayer(plots);
      if (!map.hasLayer(dots)) dots.addTo(map);
    }
    renderLegend();
  }
  map.on('zoomend moveend', syncZoomLayers);

  function loadVisibleCells() {
    const b = map.getBounds().pad(0.2);
    const c = grid.cell;
    for (let i = Math.floor(b.getWest() / c); i <= Math.floor(b.getEast() / c); i++) {
      for (let j = Math.floor(b.getSouth() / c); j <= Math.floor(b.getNorth() / c); j++) {
        const key = `${i}_${j}`;
        if (!grid.cells[key] || grid.loaded.has(key)) continue;
        grid.loaded.add(key);
        load(`grid/${key}.json`).then((fc) => {
          if (!grid.loaded.has(key)) return;   // unloaded while it was downloading
          cellLayers.set(key, []);
          loadingCell = key;
          plots.addData(fc);
          loadingCell = null;
          restyle([...state.sel, state.current].filter(Boolean));
          if (state.pendingDetail && plotLayers.has(state.pendingDetail) && state.pendingDetail === state.current) {
            state.pendingDetail = null;
            renderDetail();
          }
        }).catch(() => grid.loaded.delete(key));
      }
    }
    unloadFarCells();
  }
  function unloadFarCells() {
    const far = map.getBounds().pad(1.5);
    const c = grid.cell;
    for (const [key, layers] of cellLayers) {
      const [i, j] = key.split('_').map(Number);
      const cellBounds = L.latLngBounds([j * c, i * c], [(j + 1) * c, (i + 1) * c]);
      if (far.intersects(cellBounds)) continue;
      for (const l of layers) {
        const id = l.feature.properties.id;
        if (id === state.current) continue;
        plots.removeLayer(l);
        plotLayers.delete(id);
      }
      cellLayers.delete(key);
      grid.loaded.delete(key);
    }
  }

  // Bring a point into view; on phones keep it in the part of the map above the bottom sheet.
  function focusOn(lat, lon, zoom) {
    const z = Math.max(map.getZoom(), zoom);
    let target = L.latLng(lat, lon);
    if (isPhone()) {
      // Centre the point between the top bar and the bottom sheet.
      const pt = map.project(target, z).add([0, (sheetHeight() - topHeight()) / 2]);
      target = map.unproject(pt, z);
    }
    map.flyTo(target, z, { duration: 0.6 });
  }
  function fitRows(rows) {
    if (!rows.length) return toast('Няма какво да се покаже');
    const b = L.latLngBounds(rows.map((r) => [r.lat, r.lon]));
    map.flyToBounds(b, {
      paddingTopLeft: [40, 40 + (isPhone() ? topHeight() : 0)], paddingBottomRight: [40, 40 + (isPhone() ? sheetHeight() : 0)],
      maxZoom: 17, duration: 0.6,
    });
  }

  // ---------- Data ----------
  Promise.all([load('zone_rules.json'), load('plot_index.json'), load('grid/index.json'), load('entities.json')])
    .then(([rules, idx, g, ent]) => {
      state.rules = rules;
      grid.cell = g.cell;
      grid.cells = g.cells;
      state.rows = idx.rows.map((r) => {
        const cat = idx.cats[r[5]];
        const owner = typeof r[8] === 'string' ? r[8]
          : cat === 'unknown' ? 'няма данни' : r[8] > 1 ? `${r[8]} физически лица` : 'физическо лице';
        const id = idx.prefix + r[0];
        return {
          id, area: r[1], district: idx.districts[r[2]], zone: r[3], status: idx.statuses[r[4]], cat,
          max_floor: r[6], built: r[7], owner, lat: r[9], lon: r[10], qn: norm(owner, true),
        };
      });
      state.rows.forEach((r) => state.byId.set(r.id, r));
      state.entities = ent.entities.map(([name, eik, kind, aliases, ids], i) => {
        const full = ids.map((s) => ent.prefix + s);
        let area = 0, freeArea = 0;
        const byStatus = {};
        for (const id of full) {
          const r = state.byId.get(id);
          if (!r) continue;
          area += r.area || 0;
          if (r.status === 'free' || r.status === 'partial') freeArea += r.area || 0;
          byStatus[r.status] = (byStatus[r.status] || 0) + 1;
        }
        const e = { i, name, eik, kind: ent.kinds[kind], aliases, ids: full, area, freeArea, byStatus,
          qn: norm(name + ' ' + aliases), qnFull: norm(name, true) };
        full.forEach((id) => {
          if (!state.entitiesByPlot.has(id)) state.entitiesByPlot.set(id, []);
          state.entitiesByPlot.get(id).push(e);
        });
        return e;
      });
      buildControls(idx.districts);
      initOwnersTab();
      apply();
      openFromHash();
      syncZoomLayers();
      renderFavs();
      load('meta.json').catch(() => null).then(initChanges);
      Promise.allSettled([load('auctions.json'), load('pup.json')]).then(([a, p]) => initFeed(
        a.status === 'fulfilled' ? a.value : null, p.status === 'fulfilled' ? p.value : null));
      load('oup.geojson').then((d) => zones.addData(d));
      for (const k of Object.keys(restrictionParts)) load(`${k}.geojson`).then((d) => restrictionParts[k].addData(d));
    })
    .catch((err) => {
      $('#summary').textContent = 'Грешка при зареждане на данните: ' + err.message;
      setTab('list');
    });

  function openFromHash() {
    const h = new URLSearchParams(location.hash.slice(1));
    const ids = (h.get('ids') || '').split(',').filter(Boolean).map((s) => (s.includes('.') && s.startsWith('10135') ? s : '10135.' + s));
    const valid = ids.filter((id) => state.byId.has(id));
    if (valid.length) {
      valid.forEach((id) => state.sel.add(id));
      renderSelection();
      fitRows(valid.map((id) => state.byId.get(id)));
      toast(`Отворен споделен списък: ${valid.length} парцела`);
      return;
    }
    const one = h.get('id');
    if (one && state.byId.has(one)) openDetail(one, true);
    else setTab('filters');
  }

  // ---------- Controls ----------
  function checklist(el, defs, set, countKey) {
    const counts = {};
    state.rows.forEach((r) => { counts[r[countKey]] = (counts[r[countKey]] || 0) + 1; });
    el.innerHTML = '';
    for (const [k, s] of Object.entries(defs)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'opt';
      b.style.setProperty('--c', s.color);
      b.title = s.desc;
      b.setAttribute('aria-pressed', set.has(k));
      b.innerHTML = `<i></i><span class="opt-name">${s.short || s.label}</span><span class="n">${nf.format(counts[k] || 0)}</span>
        <svg class="tick" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 12.5 4 4 8-9"/></svg>`;
      b.addEventListener('click', () => {
        set.has(k) ? set.delete(k) : set.add(k);
        b.setAttribute('aria-pressed', set.has(k));
        apply();
      });
      el.appendChild(b);
    }
  }
  const PRESETS = {
    free: { owners: ['mun_private', 'state', 'company', 'mixed'], statuses: ['free', 'partial'], minArea: '500' },
    municipal: { owners: ['mun_private'], statuses: ['free', 'partial', 'estate'], minArea: '0' },
    firms: { owners: ['company', 'mixed'], statuses: ['free', 'partial'], minArea: '500' },
    all: { owners: Object.keys(OWNER), statuses: Object.keys(STATUS), minArea: '0' },
  };
  function setFilters(f) {
    state.owners = new Set(f.owners);
    state.statuses = new Set(f.statuses);
    checklist($('#owner-list'), OWNER, state.owners, 'cat');
    checklist($('#status-list'), STATUS, state.statuses, 'status');
    $('#min-area').value = f.minArea;
    $('#district').value = '';
    $('#zone-group').value = '';
    apply();
  }
  function markPreset() {
    const same = (a, b) => a.size === b.length && b.every((x) => a.has(x));
    document.querySelectorAll('[data-preset]').forEach((b) => {
      const p = PRESETS[b.dataset.preset];
      const on = same(state.owners, p.owners) && same(state.statuses, p.statuses) && $('#min-area').value === p.minArea
        && !$('#district').value && !$('#zone-group').value;
      b.setAttribute('aria-pressed', on);
    });
  }
  const PRESET_NAMES = { free: 'Свободни терени', municipal: 'Общински терени', firms: 'Терени на фирми', all: 'Всички парцели' };
  function renderFilterSummary() {
    const preset = document.querySelector('[data-preset][aria-pressed="true"]');
    const parts = [];
    if (preset) parts.push(PRESET_NAMES[preset.dataset.preset]);
    else {
      parts.push(state.owners.size === Object.keys(OWNER).length ? 'Всички собственици' : `${state.owners.size} вида собственици`);
      parts.push(state.statuses.size === Object.keys(STATUS).length ? 'всяко състояние' : `${state.statuses.size} състояния`);
    }
    const minArea = +$('#min-area').value;
    if (minArea && !preset) parts.push(`≥ ${num(minArea)} м²`);
    if (minArea && preset && minArea !== +PRESETS[preset.dataset.preset].minArea) parts.push(`≥ ${num(minArea)} м²`);
    if ($('#district').value) parts.push($('#district').value);
    if ($('#zone-group').value) parts.push('зона ' + $('#zone-group').value);
    $('#filter-summary').textContent = parts.join(' · ');
    $('#filters-apply').textContent = state.matched.length ? `Покажи ${nf.format(state.matched.length)} ${state.matched.length === 1 ? 'парцел' : 'парцела'}` : 'Няма парцели по тези филтри';
  }
  function initSegments() {
    document.querySelectorAll('.seg[data-for]').forEach((seg) => {
      const input = document.getElementById(seg.dataset.for);
      const sync = () => seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.value === input.value));
      seg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
        input.value = b.dataset.value;
        sync();
        input.dispatchEvent(new Event('change'));
      }));
      input.addEventListener('sync', sync);
      sync();
    });
  }
  function renderExplain() {
    $('#explain-list').innerHTML = [...Object.values(OWNER), ...Object.values(STATUS)]
      .map((s) => `<dt><i style="--c:${s.color}"></i>${s.short || s.label}</dt><dd>${s.desc}</dd>`).join('');
  }

  function buildControls(districts) {
    checklist($('#owner-list'), OWNER, state.owners, 'cat');
    checklist($('#status-list'), STATUS, state.statuses, 'status');
    const sel = $('#district');
    districts.filter(Boolean).sort().forEach((d) => sel.add(new Option(d, d)));
    const f = saved || DEFAULTS;
    $('#min-area').value = f.minArea ?? DEFAULTS.minArea;
    $('#district').value = f.district ?? '';
    $('#zone-group').value = f.zone ?? '';
    $('#sort').value = f.sort ?? DEFAULTS.sort;
    $('#color-by').value = f.colorBy ?? DEFAULTS.colorBy;
    initSegments();
    renderExplain();
    document.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => setFilters(PRESETS[b.dataset.preset])));
    const groups = { owners: [OWNER, '#owner-list', 'cat'], statuses: [STATUS, '#status-list', 'status'] };
    const fill = (key, all) => {
      const [defs, el, countKey] = groups[key];
      state[key] = new Set(all ? Object.keys(defs) : []);
      checklist($(el), defs, state[key], countKey);
      apply();
    };
    document.querySelectorAll('[data-all]').forEach((b) => b.addEventListener('click', () => fill(b.dataset.all, true)));
    document.querySelectorAll('[data-none]').forEach((b) => b.addEventListener('click', () => fill(b.dataset.none, false)));
    for (const id of ['#min-area', '#district', '#zone-group', '#sort']) $(id).addEventListener('change', apply);
    $('#color-by').addEventListener('change', () => { apply(); renderLegend(); });
    $('#reset-filters').addEventListener('click', () => {
      $('#sort').value = DEFAULTS.sort; $('#color-by').value = DEFAULTS.colorBy;
      $('#sort').dispatchEvent(new Event('sync')); $('#color-by').dispatchEvent(new Event('sync'));
      setFilters({ owners: DEFAULTS.owners, statuses: DEFAULTS.statuses, minArea: DEFAULTS.minArea });
      renderLegend();
      toast('Филтрите са върнати по подразбиране');
    });

    document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab === 'list' ? 'filters' : b.dataset.tab)));
    $('#open-filters').addEventListener('click', () => setTab('filters'));
    $('#filters-apply').addEventListener('click', () => setTab('list'));
    $('#fit-results').addEventListener('click', () => { fitRows(state.matched.slice(0, MAX_DOTS)); });
    $('#select-all').addEventListener('click', () => {
      const take = state.matched.slice(0, MAX_SELECT_ALL);
      const before = [...state.sel];
      state.sel = new Set(take.map((r) => r.id));
      restyle(before);
      renderSelection();
      toast(state.matched.length > MAX_SELECT_ALL ? `Избрани първите ${nf.format(MAX_SELECT_ALL)}` : `Избрани ${nf.format(take.length)}`);
    });
    $('#export-list').addEventListener('click', () => exportCsv(state.matched, 'spisak'));
    $('#fit-favs').addEventListener('click', () => fitRows(favRows()));
    $('#export-favs').addEventListener('click', () => exportCsv(favRows(), 'lyubimi'));
    $('#share-favs').addEventListener('click', () => shareLink([...state.favs.keys()]));
    $('#clear-favs').addEventListener('click', () => {
      if (!state.favs.size || !confirm(`Да се изтрият ли всички ${state.favs.size} любими?`)) return;
      const ids = [...state.favs.keys()];
      state.favs.clear(); saveFavs(); restyle(ids); renderFavs(); renderDots(); refreshListMarks();
    });
    $('#sel-fav').addEventListener('click', () => {
      let n = 0;
      state.sel.forEach((id) => { if (!state.favs.has(id)) { state.favs.set(id, { t: Date.now(), note: '' }); n++; } });
      saveFavs(); renderFavs(); restyle(state.sel); renderDots(); refreshListMarks();
      toast(n ? `Добавени в любими: ${n}` : 'Всички вече са в любими');
    });
    $('#sel-fit').addEventListener('click', () => fitRows([...state.sel].map((id) => state.byId.get(id))));
    $('#sel-export').addEventListener('click', () => exportCsv([...state.sel].map((id) => state.byId.get(id)), 'izbrani'));
    $('#sel-share').addEventListener('click', () => shareLink([...state.sel]));
    $('#sel-clear').addEventListener('click', () => { const ids = [...state.sel]; state.sel.clear(); restyle(ids); renderSelection(); });

    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement !== $('#search')) { e.preventDefault(); $('#search').focus(); }
      if (e.key === 'Escape') {
        if (!$('#suggest').hidden) hideSuggest();
        else if (state.current) closeDetail();
        else if (rect.active) stopRect();
      }
    });
  }

  function renderSheetTitle() {
    const t = state.tab;
    const n = (x) => (x ? `<span>${nf.format(x)}</span>` : '');
    const titles = {
      list: `Парцели${n(state.matched.length && !state.mode ? state.matched.length : 0)}`,
      filters: 'Филтри',
      auctions: 'Търгове',
      pup: 'ПУП',
      changes: 'Промени',
      favs: `Любими${n(state.favs.size)}`,
      detail: state.current ? cad(state.current) : 'Парцел',
    };
    $('#sheet-title').innerHTML = titles[t] || '';
  }
  function setTab(tab) {
    const wasFavs = state.tab === 'favs';
    state.tab = tab;
    if (tab !== 'detail') {
      const want = tab === 'auctions' || tab === 'pup' || tab === 'changes' ? tab : null;
      if (want !== state.mode) {
        state.mode = want;
        if (state.rows.length) apply();
      }
    }
    if (state.rows.length && (wasFavs || tab === 'favs')) renderDots();
    const shown = tab === 'filters' ? 'list' : tab;
    document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === shown));
    renderSheetTitle();
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + tab));
    $('.views').scrollTop = 0;
  }

  function saveFilters() {
    store.set(KEY.filters, {
      owners: [...state.owners], statuses: [...state.statuses], minArea: $('#min-area').value,
      district: $('#district').value, zone: $('#zone-group').value, sort: $('#sort').value, colorBy: $('#color-by').value,
    });
  }

  // ---------- Filtering ----------
  function apply() {
    const minArea = +$('#min-area').value;
    const district = $('#district').value;
    const zg = $('#zone-group').value;
    const sort = $('#sort').value;
    const passes = (r) => state.owners.has(r.cat) && state.statuses.has(r.status) && r.area >= minArea
      && (!district || r.district === district) && (!zg || (r.zone || '').startsWith(zg));
    let list;
    if (state.mode) {
      const ids = new Set(visibleEvents(state.mode).flatMap((e) => e.plot_ids));
      list = [...ids].map((id) => state.byId.get(id)).filter(Boolean);
    } else if (state.entity || state.text) {
      let all;
      if (state.entity) all = state.entity.ids.map((id) => state.byId.get(id)).filter(Boolean);
      else {
        const tokens = norm(state.text, true).split(' ').filter(Boolean);
        all = state.rows.filter((r) => r.id.includes(state.text) || (tokens.length && tokens.every((t) => r.qn.includes(t))));
      }
      const inFilters = all.filter(passes);
      state.scope = { total: all.length, inFilters: inFilters.length };
      list = state.searchAll ? all : inFilters;
    } else {
      list = state.rows.filter(passes);
    }
    list.sort((a, b) => (b[sort] || 0) - (a[sort] || 0));
    state.matched = list;
    state.matchSet = new Set(list.map((r) => r.id));
    const dropped = [...state.sel].filter((id) => !state.matchSet.has(id));
    if (dropped.length) {
      dropped.forEach((id) => state.sel.delete(id));
      restyle(dropped);
      renderSelection();
    }
    saveFilters();

    renderDots();
    plots.eachLayer((l) => l.setStyle(polyStyle(l.feature.properties.id)));
    renderActiveFilter();
    renderSummary();
    renderList();
    if ($('#list-mode').value === 'owners') renderOwners();
    markPreset();
    renderFilterSummary();
    renderSheetTitle();
    document.body.classList.remove('loading');
    if (document.querySelector('.legend')) renderLegend();
  }

  function renderDots() {
    const extra = state.tab === 'favs'
      ? [...state.favs.keys()].filter((id) => !state.matchSet.has(id)).map((id) => state.byId.get(id)).filter(Boolean)
      : [];
    dots.setRows(state.matched.slice(0, MAX_DOTS).concat(extra));
  }

  function renderActiveFilter() {
    const el = $('#active-filter');
    if (!state.entity && !state.text) { el.hidden = true; return; }
    el.hidden = false;
    const total = state.matched.reduce((s, r) => s + (r.area || 0), 0);
    const e = state.entity;
    const { total: all, inFilters } = state.scope;
    const word = (k) => (k === 1 ? 'парцел' : 'парцела');
    const count = all === inFilters
      ? `${nf.format(all)} ${word(all)}`
      : state.searchAll
        ? `всички ${nf.format(all)} ${word(all)} · ${nf.format(inFilters)} по филтрите`
        : `${nf.format(inFilters)} от ${nf.format(all)} ${word(all)} по филтрите`;
    const byStatus = {};
    state.matched.forEach((r) => { byStatus[r.status] = (byStatus[r.status] || 0) + 1; });
    const breakdown = Object.keys(STATUS).filter((k) => byStatus[k])
      .map((k) => `<span class="chip-s" style="--c:${STATUS[k].color}">${STATUS[k].label} ${byStatus[k]}</span>`).join('');
    const scopeBtn = all === inFilters ? ''
      : state.searchAll
        ? `<button type="button" class="btn-text af-scope">Само по филтрите (${nf.format(inFilters)})</button>`
        : `<button type="button" class="btn-text af-scope">Покажи всичките ${nf.format(all)}</button>`;
    el.innerHTML = `<button type="button" class="af-back">‹ Всички парцели</button>
      <div class="af-text">
        <b>${e ? esc(e.name) : `Търсене: „${esc(state.text)}“`}</b>
        <span>${e && e.eik ? `ЕИК ${esc(e.eik)} · ` : ''}${count} · ${ha(total)} ха</span>
        ${breakdown ? `<div class="chips">${breakdown}</div>` : ''}
        ${scopeBtn}
      </div>`;
    el.querySelector('.af-back').onclick = clearSearch;
    const sb = el.querySelector('.af-scope');
    if (sb) sb.onclick = () => { state.searchAll = !state.searchAll; apply(); fitRows(state.matched); };
  }

  function renderSummary() {
    const list = state.matched;
    const total = list.reduce((s, r) => s + (r.area || 0), 0);
    if (!state.mode) $('#n-list').textContent = list.length ? nf.format(list.length) : '';
    $('#summary').innerHTML = list.length
      ? `<b>${nf.format(list.length)}</b> парцела · <b>${ha(total)}</b> ха`
        + (list.length > MAX_DOTS ? `<br>На картата: най-големите ${nf.format(MAX_DOTS)}.` : '')
      : (state.entity || state.text ? 'Нищо не е намерено.' : 'Няма парцели по тези филтри. Отметнете още собственици или състояния.');
  }

  // ---------- Lists ----------
  function rowHtml(r, withNote) {
    const fav = state.favs.get(r.id);
    const st = STATUS[r.status];
    return `<input type="checkbox" class="pick" ${state.sel.has(r.id) ? 'checked' : ''} aria-label="Избери ${r.id}">
      <div class="main">
        <div class="line1"><span class="id"><i style="--c:${colorOf(r)}"></i>${cad(r.id)}</span><span class="area">${num(r.area, ' м²')}</span></div>
        <div class="owner ${r.cat === 'person' || r.cat === 'unknown' ? 'person' : ''}">${esc(r.owner)}</div>
        <div class="chips">
          <span class="chip-s" style="--c:${st.color}">${st.label}</span>
          ${r.zone ? `<span class="chip-s plain">${esc(r.zone)}</span>` : ''}
          ${r.district ? `<span class="chip-s plain">${esc(r.district)}</span>` : ''}
          ${r.max_floor ? `<span class="chip-s plain mono">РЗП ≤ ${num(r.max_floor, ' м²')}</span>` : ''}
        </div>
        ${withNote && fav?.note ? `<div class="note-line">${esc(fav.note)}</div>` : ''}
      </div>
      <button type="button" class="star ${fav ? 'on' : ''}" aria-label="Любим">${fav ? '★' : '☆'}</button>`;
  }
  function bindRow(li, r) {
    li.addEventListener('click', (e) => {
      if (e.target.closest('.pick')) { toggleSel(r.id, e.target.checked); return; }
      if (e.target.closest('.star')) { toggleFav(r.id); return; }
      onPlotClick(r.id, e, true);
    });
  }
  function renderList() {
    const ol = $('#results');
    ol.innerHTML = '';
    const frag = document.createDocumentFragment();
    state.matched.slice(0, LIST_LIMIT).forEach((r) => {
      const li = document.createElement('li');
      li.dataset.id = r.id;
      li.innerHTML = rowHtml(r, false);
      li.classList.toggle('sel', state.sel.has(r.id));
      li.classList.toggle('current', r.id === state.current);
      bindRow(li, r);
      frag.appendChild(li);
    });
    if (state.matched.length > LIST_LIMIT) {
      const more = document.createElement('li');
      more.className = 'more';
      more.textContent = `… и още ${nf.format(state.matched.length - LIST_LIMIT)}. Стеснете филтрите или използвайте „Експорт“.`;
      frag.appendChild(more);
    }
    ol.appendChild(frag);
  }
  function refreshListMarks() {
    document.querySelectorAll('.results li[data-id]').forEach((li) => {
      const id = li.dataset.id;
      li.classList.toggle('sel', state.sel.has(id));
      li.classList.toggle('current', id === state.current);
      const pick = li.querySelector('.pick');
      if (pick) pick.checked = state.sel.has(id);
      const star = li.querySelector('.star');
      if (star) { const on = state.favs.has(id); star.classList.toggle('on', on); star.textContent = on ? '★' : '☆'; }
    });
  }

  // ---------- Favourites ----------
  const favRows = () => [...state.favs.keys()].map((id) => state.byId.get(id)).filter(Boolean);
  function saveFavs() { store.set(KEY.favs, Object.fromEntries(state.favs)); }
  function toggleFav(id) {
    if (state.favs.has(id)) { state.favs.delete(id); toast('Премахнат от любими'); }
    else { state.favs.set(id, { t: Date.now(), note: '' }); toast('Добавен в любими'); }
    saveFavs(); restyle([id]); renderDots(); renderFavs(); refreshListMarks();
    if (state.current === id) renderDetail();
  }
  function renderFavs() {
    const rows = favRows().sort((a, b) => (state.favs.get(b.id).t || 0) - (state.favs.get(a.id).t || 0));
    $('#n-favs').textContent = rows.length ? nf.format(rows.length) : '';
    const total = rows.reduce((s, r) => s + (r.area || 0), 0);
    $('#favs-intro').textContent = rows.length
      ? `${nf.format(rows.length)} любими · ${ha(total)} ха. Пазят се в този браузър; „Копирай линк“ ги праща на друг.`
      : 'Добавете парцели с ☆. Любимите се пазят в този браузър.';
    const ol = $('#fav-list');
    ol.innerHTML = '';
    rows.forEach((r) => {
      const li = document.createElement('li');
      li.dataset.id = r.id;
      li.innerHTML = rowHtml(r, true);
      li.classList.toggle('sel', state.sel.has(r.id));
      bindRow(li, r);
      ol.appendChild(li);
    });
  }

  // ---------- Selection ----------
  function toggleSel(id, on) {
    const want = on ?? !state.sel.has(id);
    want ? state.sel.add(id) : state.sel.delete(id);
    restyle([id]);
    renderSelection();
  }
  function renderSelection() {
    const bar = $('#selbar');
    const rows = [...state.sel].map((id) => state.byId.get(id)).filter(Boolean);
    document.body.classList.toggle('selecting', state.markMode || state.sel.size > 0);
    bar.hidden = !rows.length;
    if (rows.length) {
      const area = rows.reduce((s, r) => s + (r.area || 0), 0);
      const floor = rows.reduce((s, r) => s + (r.max_floor || 0), 0);
      const owners = new Set(rows.map((r) => r.owner)).size;
      $('#selinfo').innerHTML = `<b>${nf.format(rows.length)} избрани от списъка</b> · ${num(area, ' м²')}${floor ? ' · макс. РЗП ' + num(floor, ' м²') : ''} · ${nf.format(owners)} ${owners === 1 ? 'собственик' : 'собственика'}`;
    }
    renderDots();
    refreshListMarks();
    restyle(rows.map((r) => r.id));
    if (state.current) renderDetail();
    if (state.rows.length && $('#list-mode').value === 'owners') renderOwners();
    updateSheetForSelbar();
  }

  // ---------- Click handling ----------
  function onPlotClick(id, ev, fromList) {
    if (Date.now() - rect.endedAt < 400) return;  // the click that ends a rectangle selection
    const multi = ev && (ev.shiftKey || ev.metaKey || ev.ctrlKey);
    if (state.markMode || multi) { toggleSel(id); return; }
    openDetail(id, fromList || map.getZoom() < POLY_ZOOM);
  }

  // ---------- Detail ----------
  function openDetail(id, fly) {
    const r = state.byId.get(id);
    if (!r) return;
    const prev = state.current;
    state.current = id;
    history.replaceState(null, '', '#id=' + encodeURIComponent(id));
    restyle([prev, id].filter(Boolean));
    refreshListMarks();
    if (fly) focusOn(r.lat, r.lon, 17);
    if (!plotLayers.has(id)) state.pendingDetail = id;
    renderDetail();
    setTab('detail');
    if (isPhone() && sheet.state === 'peek') snapSheet('half');
  }
  function closeDetail() {
    const id = state.current;
    state.current = null;
    history.replaceState(null, '', location.pathname + location.search);
    restyle([id]);
    refreshListMarks();
    setTab(state.entity || state.text ? 'list' : (state.lastTab || 'list'));
  }
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => { state.lastTab = b.dataset.tab; }));

  function renderDetail() {
    const id = state.current;
    const r = state.byId.get(id);
    if (!r) return;
    const p = factsOf(id);
    const o = OWNER[r.cat] || OWNER.unknown;
    const s = STATUS[r.status];
    const fav = state.favs.get(id);
    const sel = state.sel.has(id);
    const ents = state.entitiesByPlot.get(id) || [];
    let body = '';
    if (p) {
      const eiks = (p.eiks || '').split(' | ').filter(Boolean);
      const alt = p.alt_rule || '';
      const altApplies = alt && !(alt.startsWith('Зона Б') && !p.zone_b) && !(alt.startsWith('Зона А') && !p.zone_a);
      const notes = [];
      if (p.status === 'estate') notes.push('Терен в жилищен комплекс: вероятно междублоково пространство. ОУП предвижда незастроените части да станат озеленени площи. Проверете ортофото и ПУП.');
      if (p.zone === 'Жм2') notes.push('Показателите за Жм2 не са в Приложение 1 — проверете специфичните правила.');
      if (p.owner_cat === 'mun_public') notes.push('Публична общинска собственост не може да се продава, освен ако общината не я обяви за частна.');
      const facts = [
        eiks.length && !ents.length ? ['ЕИК', eiks.map(esc).join('<br>')] : null,
        ['Вид собственост', esc(p.prop || '—')],
        ['Район', esc((p.district || '—').replace(/^район /, ''))],
        ['По кадастър', esc(p.use_type || '—')],
        ['Зона по ОУП', p.zone ? `${esc(p.zone)}${p.zone_name ? ' — ' + esc(p.zone_name) : ''}` : '—'],
        p.kint ? ['Макс. плътност / Кинт', `${p.density ?? '—'}% / ${p.kint}`] : null,
        p.cornice ? ['Макс. корниз', p.cornice + ' м'] : null,

        ['Застроеност', `${p.built ?? 0}% (${p.n_buildings || 0} сгр.${p.max_floors ? `, до ${p.max_floors} ет.` : ''})`],
      ].filter(Boolean);
      const flags = FLAGS.filter(([k]) => p[k]);
      body = `<div class="flags">${flags.length ? flags.map(([, t, cls]) => `<span class="flag ${cls || ''}">${t}</span>`).join('') : '<span class="flag ok">Без открити ограничения</span>'}</div>
        ${notes.map((n) => `<p class="note">${n}</p>`).join('')}
        <details class="more-facts" ${store.get('varna-plots:facts-open', false) ? 'open' : ''}>
          <summary>Подробности за парцела</summary>
          <dl class="facts">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
          ${altApplies ? `<p class="alt">Допълнително: ${esc(alt)}</p>` : ''}
        </details>`;
    } else {
      body = `<p class="loading-text">Зареждане на подробностите…</p>`;
    }
    const persons = r.cat === 'person' || r.cat === 'mixed' ? (r.owner.match(/(\d+ физически лица|физическо лице)/) || [])[0] : '';
    const ownersHtml = `<div class="owner-cards">${ents.map((e) => `
      <button type="button" class="owner-card" data-ent="${e.i}">
        <span class="oc-name">${esc(e.name)}</span>
        <span class="oc-meta">${e.eik ? `ЕИК ${esc(e.eik)} · ` : ''}${nf.format(e.ids.length)} ${e.ids.length === 1 ? 'парцел' : 'парцела'} · ${ha(e.area)} ха</span>
        <span class="oc-go">${e.ids.length > 1 ? `Виж всичките ${nf.format(e.ids.length)} ›` : 'Виж ›'}</span>
      </button>`).join('')}
      ${persons ? `<div class="owner-card plain"><span class="oc-name">${esc(persons)}</span><span class="oc-meta">Имената на физическите лица не се показват</span></div>` : ''}
      ${!ents.length && !persons ? `<div class="owner-card plain"><span class="oc-name">${esc(r.owner)}</span></div>` : ''}
    </div>`;
    const pp = p || {};
    $('#detail').innerHTML = `<div class="detail">
      <div class="detail-top">
        <button type="button" class="back" data-act="back">‹ Назад</button>
        <div class="icon-actions">
          <button type="button" class="icon-btn ${fav ? 'fav-on' : ''}" data-act="fav" title="${fav ? 'Махни от любими' : 'Добави в любими'}" aria-label="Любим" aria-pressed="${!!fav}">${ICON.star}</button>
          <button type="button" class="icon-btn ${sel ? 'sel-on' : ''}" data-act="sel" title="${sel ? 'Махни от избраните' : 'Избери'}" aria-label="Избери" aria-pressed="${sel}">${ICON.check}</button>
        </div>
      </div>
      <h2 class="did">${cad(id)}</h2>
      ${pp.address ? `<p class="addr">${esc(pp.address)}</p>` : ''}
      <div class="badges"><span class="badge" style="--c:${o.color}">${o.short}</span><span class="badge" style="--c:${s.color}">${s.label}</span>${r.zone ? `<span class="badge" style="--c:var(--faint)">${esc(r.zone)}</span>` : ''}</div>
      <div class="bignum">
        <div><b>${num(r.area)} м²</b><span>Площ</span></div>
        ${r.max_floor ? `<div><b>${num(r.max_floor)} м²</b><span>Макс. РЗП по ОУП</span></div>` : ''}
      </div>
      ${signalsHtml(id)}
      ${changesHtml(id)}
      ${ownersHtml}
      ${fav ? `<textarea class="fav-note" placeholder="Бележка (пази се с любимите)">${esc(fav.note || '')}</textarea>` : ''}
      ${body}
      <div class="links">
        <a href="https://www.google.com/maps?q=${r.lat},${r.lon}" target="_blank" rel="noopener">Google Maps</a>
        <a href="https://kais.cadastre.bg/bg/Map" target="_blank" rel="noopener">КАИС</a>
        <button type="button" data-act="copy">Копирай идентификатора</button>
        <button type="button" data-act="link">Копирай линк</button>
      </div>
    </div>`;
    const d = $('#detail');
    d.querySelector('[data-act=back]').onclick = closeDetail;
    d.querySelector('[data-act=fav]').onclick = () => toggleFav(id);
    d.querySelector('[data-act=sel]').onclick = () => toggleSel(id);
    d.querySelector('[data-act=copy]').onclick = () => copy(id, 'ID е копиран');
    d.querySelector('[data-act=link]').onclick = () => copy(location.origin + location.pathname + '#id=' + id, 'Линкът е копиран');
    const note = d.querySelector('.fav-note');
    if (note) note.oninput = () => { const f = state.favs.get(id); if (f) { f.note = note.value; saveFavs(); } };
    d.querySelectorAll('[data-ent]').forEach((b) => { b.onclick = () => chooseEntity(state.entities[+b.dataset.ent], true); });
    const more = d.querySelector('.more-facts');
    if (more) more.addEventListener('toggle', () => store.set('varna-plots:facts-open', more.open));
  }

  // ---------- Търгове and ПУП sections (events from the daily sources) ----------
  const EVENT = {
    auction: { label: 'Търг', plural: 'Търгове', color: 'var(--reg)' },
    pup_request: { label: 'Поискан ПУП', plural: 'Поискан ПУП', color: '#0f6e8c' },
    pup_approved: { label: 'Одобрен ПУП', plural: 'Одобрен ПУП', color: '#7c3aed' },
  };
  const today = new Date().toISOString().slice(0, 10);
  const shortDate = (iso) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}` : '');
  const longDate = (iso) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '');
  const AUCTION_KINDS = { plots: 'Парцели', land: 'Земя', homes: 'Жилища и къщи', other: 'Други' };
  function auctionKind(t) {
    if (/Парцел/.test(t)) return 'plots';
    if (/Земеделск/.test(t)) return 'land';
    if (/апартамент|Мезонет|Ателие|Стая|Къща|Вила|Етаж от къща|Жилищна сграда/.test(t)) return 'homes';
    return 'other';
  }
  const PUP_TYPES = { pup_request: 'Поискани', pup_approved: 'Одобрени' };
  function toggleChips(el, defs, set, counts, onChange) {
    el.innerHTML = Object.entries(defs).filter(([k]) => counts[k]).map(([k, label]) =>
      `<label class="lchip"><input type="checkbox" value="${k}" ${set.has(k) ? 'checked' : ''}><span>${label} ${nf.format(counts[k])}</span></label>`).join('');
    el.querySelectorAll('input').forEach((cb) => cb.addEventListener('change', () => {
      cb.checked ? set.add(cb.value) : set.delete(cb.value);
      onChange();
    }));
  }
  function initFeed(auctions, pup) {
    const events = [];
    if (auctions) {
      state.feedUpdated = auctions.updated || '';
      Object.values(auctions.listings)
        .filter((a) => !a.removed && (!a.announce || a.announce >= today) && a.settlement === 'гр. Варна')
        .forEach((a) => events.push({
          kind: 'auction', date: a.published || a.first_seen, a, akind: auctionKind(a.type),
          all_ids: a.cad_ids, plot_ids: a.plot_ids.filter((id) => state.byId.has(id)),
        }));
    }
    if (pup) {
      pup.requests.forEach((r) => events.push({ kind: 'pup_request', date: r.date, r, all_ids: r.plot_ids, plot_ids: r.plot_ids.filter((id) => state.byId.has(id)) }));
      pup.approvals.forEach((r) => events.push({ kind: 'pup_approved', date: r.date, r, all_ids: r.plot_ids, plot_ids: r.plot_ids.filter((id) => state.byId.has(id)) }));
    }
    events.sort((x, y) => (y.date || '').localeCompare(x.date || ''));
    state.events = events;
    state.signalsByPlot = new Map();
    events.forEach((e) => e.plot_ids.forEach((id) => {
      if (!state.signalsByPlot.has(id)) state.signalsByPlot.set(id, []);
      state.signalsByPlot.get(id).push(e);
    }));
    const akCounts = {}, pupCounts = {};
    events.forEach((e) => {
      if (e.kind === 'auction') akCounts[e.akind] = (akCounts[e.akind] || 0) + 1;
      else pupCounts[e.kind] = (pupCounts[e.kind] || 0) + 1;
    });
    toggleChips($('#auction-kinds'), AUCTION_KINDS, state.auctionKinds, akCounts, () => renderEvents('auctions'));
    toggleChips($('#pup-types'), PUP_TYPES, state.pupTypes, pupCounts, () => renderEvents('pup'));
    $('#auction-sort').addEventListener('change', () => renderEvents('auctions'));
    let pupTimer;
    $('#pup-q').addEventListener('input', () => { clearTimeout(pupTimer); pupTimer = setTimeout(() => renderEvents('pup'), 150); });
    $('#pup-linked').addEventListener('change', () => renderEvents('pup'));
    $('#pup-period').addEventListener('change', () => renderEvents('pup'));
    const nAuctions = events.filter((e) => e.kind === 'auction').length;
    $('#n-auctions').textContent = nAuctions ? nf.format(nAuctions) : '';
    const recentPup = events.filter((e) => e.kind !== 'auction' && e.date && (Date.parse(today) - Date.parse(e.date)) / 864e5 <= 30).length;
    $('#n-pup').textContent = recentPup ? nf.format(recentPup) : '';
    $('#n-pup').title = recentPup ? `${recentPup} за последните 30 дни` : '';
    renderEvents('auctions');
    renderEvents('pup');
    if (state.current) renderDetail();
  }
  function visibleEvents(mode) {
    if (mode === 'auctions') {
      const sort = $('#auction-sort').value;
      const by = {
        deadline: (x, y) => (x.a.period_to || '9').localeCompare(y.a.period_to || '9'),
        new: (x, y) => (y.date || '').localeCompare(x.date || ''),
        price: (x, y) => (x.a.price_eur ?? Infinity) - (y.a.price_eur ?? Infinity),
        area: (x, y) => (y.a.area_m2 || 0) - (x.a.area_m2 || 0),
      }[sort];
      return state.events.filter((e) => e.kind === 'auction' && state.auctionKinds.has(e.akind)
).sort(by);
    }
    if (mode === 'changes') {
      const order = Object.keys(CHANGE_TYPES);
      return state.changeEvents.filter((e) => e.period === state.changePeriod && state.changeTypes.has(e.t))
        .sort((x, y) => order.indexOf(x.t) - order.indexOf(y.t) || (changeArea(y) - changeArea(x)));
    }
    // A search looks through every year; the period only limits the plain list.
    const tokens = norm($('#pup-q').value, true).split(' ').filter(Boolean);
    const days = tokens.length ? 0 : +$('#pup-period').value;
    const since = days ? new Date(Date.now() - days * 864e5).toISOString().slice(0, 10) : '';
    const linkedOnly = $('#pup-linked').checked;
    const base = state.events.filter((e) => state.pupTypes.has(e.kind)
      && (!since || (e.date || '') >= since) && (!linkedOnly || e.plot_ids.length));
    if (!tokens.length) return base;
    // Typing an order number ("Г-1", "430") finds that order; otherwise every word must be found.
    const typed = $('#pup-q').value.trim().toLowerCase();
    const byOrder = base.filter((e) => e.kind !== 'auction' && String(e.r.order).toLowerCase() === typed);
    return byOrder.length ? byOrder : base.filter((e) => tokens.every((t) => pupHaystack(e).includes(t)));
  }
  // Everything a ПУП can be found by: its text, order number, cadastral ids and the owner of the plot it is on.
  function pupHaystack(e) {
    if (e._q === undefined) {
      const r = e.r;
      const owner = e.plot_ids.map((id) => state.byId.get(id)?.owner).filter((o) => typeof o === 'string');
      e._q = norm([r.plan, r.district, r.target, r.place, r.kv, r.order, r.title, ...(e.all_ids || []), ...owner].join(' '), true);
    }
    return e._q;
  }
  const FEED_LIMIT = 300;
  function eventRow(e) {
    if (e.kind === 'change') return changeRow(e);
    const plot = e.plot_ids.length ? state.byId.get(e.plot_ids[0]) : null;
    const k = EVENT[e.kind];
    let title = '', price = '', where = '', chips = [];
    if (e.kind === 'auction') {
      const a = e.a;
      title = esc(a.type);
      price = a.price_eur != null ? num(a.price_eur, ' €') : '';
      where = `${esc(a.settlement)}${a.address && a.address !== a.settlement ? ' · ' + esc(a.address.replace(/^(гр\.|с\.)\s*[^,]+,\s*/, '')) : ''}`;
      if (a.area_m2) chips.push(`<span class="chip-s plain mono">${num(a.area_m2, ' м²')}</span>`);
      if (a.period_to) chips.push(`<span class="chip-s plain">срок до ${shortDate(a.period_to)}</span>`);
      if (a.price_change_pct < 0) chips.push(`<span class="chip-s" style="--c:#16a34a">${a.price_change_pct}% спрямо предишна</span>`);
    } else if (e.kind === 'pup_request') {
      const r = e.r;
      title = esc(r.plan || 'ПУП');
      where = [r.district, r.place].filter(Boolean).map(esc).join(' · ');
      if (r.kv) chips.push(`<span class="chip-s plain">кв. ${esc(r.kv)}</span>`);
      chips.push(`<span class="chip-s plain">заповед ${esc(r.order)}</span>`);
    } else {
      const r = e.r;
      title = 'ПУП одобрен';
      where = esc(r.title);
      chips.push(`<span class="chip-s plain">заповед ${esc(r.order)}</span>`);
    }
    const owner = plot ? `<span class="chip-s" style="--c:${OWNER[plot.cat].color}">${esc(plot.owner)}</span>`
      : e.all_ids && e.all_ids.length ? `<span class="chip-s plain mono" title="Извън картата">${esc(e.all_ids[0])}</span>` : '';
    // In Търгове every row is a sale, so the label line shows the date only; in ПУП it says which kind.
    const label = e.kind === 'auction' ? '<span></span>' : `<span class="ev-kind" style="--c:${k.color}">${k.label}</span>`;
    return `<div class="main">
        <div class="line1">${label}<span class="ev-date">${longDate(e.date)}</span></div>
        <div class="line1"><span class="atype">${title}</span>${price ? `<span class="aprice">${price}</span>` : ''}</div>
        <div class="owner person">${where}</div>
        <div class="chips">${plot ? `<span class="chip-s plain">${cad(plot.id)}</span>` : ''}${chips.join('')}${owner}</div>
      </div><span class="go">${plot ? '›' : e.kind === 'pup_request' ? '' : '↗'}</span>`;
  }
  function renderEvents(mode) {
    const list = visibleEvents(mode);
    const linked = list.filter((e) => e.plot_ids.length).length;
    const upd = state.feedUpdated ? ` · обновено ${longDate(state.feedUpdated.slice(0, 10))}` : '';
    const feed = {
      auctions: ['#auctions-summary', '#auction-results', 'продажби', upd],
      pup: ['#pup-summary', '#pup-results', 'ПУП', $('#pup-q').value.trim() ? ' · търсено във всички години' : upd],
      changes: ['#changes-summary', '#changes-results', 'промени', ''],
    }[mode];
    $(feed[0]).innerHTML = `<b>${nf.format(list.length)}</b> ${feed[2]} · <b>${nf.format(linked)}</b> на картата${feed[3]}`;
    const ol = $(feed[1]);
    ol.innerHTML = '';
    const frag = document.createDocumentFragment();
    list.slice(0, FEED_LIMIT).forEach((e) => {
      const li = document.createElement('li');
      li.className = 'event';
      li.innerHTML = eventRow(e);
      li.addEventListener('click', () => {
        if (e.plot_ids.length) openDetail(e.plot_ids[0], true);
        else if (e.kind === 'auction') window.open(e.a.url, '_blank', 'noopener');
        else if (e.r && e.r.url) window.open(e.r.url, '_blank', 'noopener');
      });
      frag.appendChild(li);
    });
    if (list.length > FEED_LIMIT) {
      const more = document.createElement('li');
      more.className = 'more';
      more.textContent = `… и още ${nf.format(list.length - FEED_LIMIT)}. Стеснете филтрите.`;
      frag.appendChild(more);
    }
    if (!list.length) {
      const li = document.createElement('li');
      li.className = 'more';
      li.textContent = 'Нищо по тези филтри.';
      frag.appendChild(li);
    }
    ol.appendChild(frag);
    if (state.mode === mode) apply();
  }
  // Signals shown at the top of a plot's details.
  function signalsHtml(id) {
    const list = state.signalsByPlot.get(id) || [];
    if (!list.length) return '';
    return `<div class="signals"><h3>Търгове и ПУП</h3>${list.map((e) => {
      if (e.kind === 'auction') {
        const a = e.a;
        return `<a class="signal auction-card" href="${esc(a.url)}" target="_blank" rel="noopener">
          <span class="ac-title">В публична продан · ЧСИ</span>
          <span class="ac-price">${a.price_eur != null ? num(a.price_eur, ' €') : '—'}<small>начална цена</small></span>
          <span class="ac-meta">${esc(a.type)}${a.area_m2 ? ' · ' + num(a.area_m2, ' м²') : ''}${a.period_to ? ` · срок до ${shortDate(a.period_to)}` : ''}${a.announce ? ` · обявяване ${shortDate(a.announce)}` : ''}</span>
          <span class="ac-meta">${esc(a.bailiff)}</span>
          <span class="ac-go">Обява на ЧСИ ↗</span>
        </a>`;
      }
      const r = e.r;
      const k = EVENT[e.kind];
      const inner = `<span class="sg-kind" style="--c:${k.color}">${k.label}</span>
          <span class="sg-text">${e.kind === 'pup_request' ? `${esc(r.plan)} · заповед ${esc(r.order)} от ${longDate(r.date)}` : `Заповед ${esc(r.order)} от ${longDate(r.date)}`}</span>
          ${e.kind === 'pup_approved' ? `<span class="sg-sub">${esc(r.title)}</span>` : ''}`;
      return r.url
        ? `<a class="signal" href="${esc(r.url)}" target="_blank" rel="noopener">${inner}<span class="sg-go">Заповед и чертеж ↗</span></a>`
        : `<div class="signal">${inner}</div>`;
    }).join('')}</div>`;
  }

  // ---------- Промени: what changed in ownership between two loads of КАИС data ----------
  const CHANGE_TYPES = {
    to_entity: { label: 'ФЛ → фирма', color: '#ea580c' },
    to_person: { label: 'Фирма → ФЛ', color: '#7c3aed' },
    swap: { label: 'Смяна на фирма', color: '#0f6e8c' },
    coowner: { label: 'Съсобственик', color: '#ca8a04' },
    category: { label: 'Вид собственост', color: '#b45309' },
    new: { label: 'Нов парцел', color: '#16a34a' },
    removed: { label: 'Изчезнал парцел', color: '#dc2626' },
    persons: { label: 'Брой ФЛ', color: '#64748b' },
    area: { label: 'Площ', color: '#64748b' },
  };
  const CHANGE_LABELS = Object.fromEntries(Object.entries(CHANGE_TYPES).map(([k, v]) => [k, v.label]));
  const dotDate = longDate;
  const personsText = (n) => (!n ? '' : n === 1 ? 'физическо лице' : `${nf.format(n)} физически лица`);
  const changeArea = (e) => (e.item.ar ? Math.max(e.item.ar[0] || 0, e.item.ar[1] || 0) : state.byId.get(e.plot_ids[0])?.area || 0);

  // One line saying what changed, as safe HTML (company names are escaped, persons are counts).
  function changeText(e) {
    const it = e.item;
    const nm = (keys) => (keys || []).map((k) => `<b>${esc((e.names[k] || ['?'])[0])}</b>`).join(', ');
    const side = (keys, persons) => [nm(keys), personsText(persons)].filter(Boolean).join(' + ') || 'без известен собственик';
    const [p0, p1] = it.p || [0, 0];
    const arrow = '<span class="chg-arrow">→</span>';
    switch (e.t) {
      case 'to_entity': return `${side([], p0)} ${arrow} ${side(it.a, p1)}`;
      case 'to_person': return `${side(it.r, p0)} ${arrow} ${side([], p1)}`;
      case 'swap': return `${side(it.r, 0)} ${arrow} ${side(it.a, 0)}`;
      case 'coowner': return [it.a && `+ ${nm(it.a)}`, it.r && `− ${nm(it.r)}`].filter(Boolean).join(' · ');
      case 'persons': return `Физически лица: ${nf.format(p0)} ${arrow} ${nf.format(p1)}`;
      case 'category': return `${esc(OWNER[it.c[0]].label)} ${arrow} ${esc(OWNER[it.c[1]].label)}`;
      case 'new': return `Нов в КАИС · ${side(it.a, p1)}`;
      case 'removed': return `Вече го няма в КАИС (обединен или разделен) · ${side(it.r, p0)}`;
      case 'area': return `Площ ${num(it.ar[0])} ${arrow} ${num(it.ar[1], ' м²')}`;
      default: return '';
    }
  }
  function changeRow(e) {
    const plot = e.plot_ids.length ? state.byId.get(e.plot_ids[0]) : null;
    const t = CHANGE_TYPES[e.t];
    const it = e.item;
    const area = it.ar && e.t !== 'area' ? (it.ar[1] ?? it.ar[0]) : plot?.area;
    const chips = [
      `<span class="chip-s plain mono">${cad(e.all_ids[0])}</span>`,
      area ? `<span class="chip-s plain mono">${num(area, ' м²')}</span>` : '',
      it.ar && !['area', 'new', 'removed'].includes(e.t) ? `<span class="chip-s plain">площ ${num(it.ar[0])} → ${num(it.ar[1], ' м²')}</span>` : '',
      it.c && !['category', 'to_entity', 'to_person'].includes(e.t) ? `<span class="chip-s plain">${esc(OWNER[it.c[0]].short)} → ${esc(OWNER[it.c[1]].short)}</span>` : '',
      plot ? '' : '<span class="chip-s plain">не е на картата</span>',
    ].join('');
    return `<div class="main">
        <div class="line1"><span class="ev-kind" style="--c:${t.color}">${t.label}</span><span class="ev-date">${dotDate(e.date)}</span></div>
        <div class="chg">${changeText(e)}</div>
        <div class="chips">${chips}</div>
      </div><span class="go">${plot ? '›' : ''}</span>`;
  }
  // The plot's own history, at the top of its details.
  function changesHtml(id) {
    const list = state.changesByPlot.get(id) || [];
    if (!list.length) return '';
    return `<div class="signals"><h3>Промени в собствеността</h3>${list.map((e) => {
      const t = CHANGE_TYPES[e.t];
      return `<div class="signal"><span class="sg-kind" style="--c:${t.color}">${t.label} · ${dotDate(e.date)}</span>
        <span class="sg-text">${changeText(e)}</span><span class="sg-sub">спрямо ${dotDate(e.from)}</span></div>`;
    }).join('')}</div>`;
  }
  function renderChangePeriods() {
    const sel = $('#changes-period');
    sel.hidden = !state.changePeriods.length;
    sel.innerHTML = state.changePeriods.map((p) =>
      `<option value="${p.id}">${dotDate(p.from)} → ${dotDate(p.to)} · ${nf.format(p.n)}</option>`).join('');
    sel.value = state.changePeriod;
  }
  function renderChangeTypes() {
    const counts = {};
    state.changeEvents.forEach((e) => { if (e.period === state.changePeriod) counts[e.t] = (counts[e.t] || 0) + 1; });
    toggleChips($('#changes-types'), CHANGE_LABELS, state.changeTypes, counts, () => renderEvents('changes'));
  }
  function initChanges(meta) {
    if (meta && meta.kais) {
      $('#stamp').textContent = `КАИС · ${dotDate(meta.kais)}`;
      $('#kais-date').textContent = dotDate(meta.kais);
    }
    const asOf = meta && meta.kais ? dotDate(meta.kais) : '';
    $('#changes-period').addEventListener('change', (ev) => {
      state.changePeriod = ev.target.value;
      renderChangeTypes();
      renderEvents('changes');
    });
    $('#changes-fit').addEventListener('click', () => fitRows(state.matched.slice(0, MAX_DOTS)));
    $('#changes-export').addEventListener('click', () => exportCsv(state.matched, 'promeni'));
    const empty = () => {
      $('#changes-summary').textContent = `Данните са от ${asOf || 'последното зареждане'}. Първите промени ще се покажат, когато заредите следващия месец от КАИС.`;
      $('#changes-results').innerHTML = '';
      $('#changes-period').hidden = true;
      document.querySelector('#view-changes .toolbar').hidden = true;
    };
    return load('changes/index.json').then(async (ix) => {
      const periods = [...ix.periods].sort((a, b) => b.id.localeCompare(a.id));
      if (!periods.length) return empty();
      const files = await Promise.allSettled(periods.map((p) => load(`changes/${p.id}.json`)));
      state.changePeriods = periods.filter((p, i) => files[i].status === 'fulfilled');
      if (!state.changePeriods.length) return empty();
      state.changePeriod = state.changePeriods[0].id;
      const events = [];
      files.forEach((f) => {
        if (f.status !== 'fulfilled') return;
        const d = f.value;
        d.items.forEach((item) => {
          const id = (d.prefix || '10135.') + item.id;
          events.push({ kind: 'change', t: item.t, item, names: d.names, period: d.to, date: d.to, from: d.from,
            all_ids: [id], plot_ids: state.byId.has(id) ? [id] : [] });
        });
      });
      state.changeEvents = events;
      state.changesByPlot = new Map();
      events.forEach((e) => e.plot_ids.forEach((id) => {
        if (!state.changesByPlot.has(id)) state.changesByPlot.set(id, []);
        state.changesByPlot.get(id).push(e);
      }));
      state.changesByPlot.forEach((l) => l.sort((a, b) => b.date.localeCompare(a.date)));
      const latest = state.changePeriods[0];
      const n = events.filter((e) => e.period === latest.id && state.changeTypes.has(e.t)).length;
      $('#n-changes').textContent = n ? nf.format(n) : '';
      $('#n-changes').title = n ? `от ${dotDate(latest.from)} до ${dotDate(latest.to)}` : '';
      $('#changes-note').textContent = 'Източник: сравнение на две зареждания на отворените данни на КАИС. Смяна от едно физическо лице на друго не се вижда, защото имената им не се пазят.';
      renderChangePeriods();
      renderChangeTypes();
      renderEvents('changes');
      if (state.current) renderDetail();
    }).catch(empty);
  }

  // ---------- Owners of the listed plots (Парцели › Собственици) ----------
  function initOwnersTab() {
    let t;
    $('#owners-filter').addEventListener('input', () => { clearTimeout(t); t = setTimeout(renderOwners, 150); });
    $('#owners-sort').addEventListener('change', renderOwners);
    document.querySelectorAll('#owners-kinds input').forEach((cb) => cb.addEventListener('change', renderOwners));
    $('#list-mode').addEventListener('change', () => {
      const owners = $('#list-mode').value === 'owners';
      $('#plots-head').hidden = $('#results').hidden = owners;
      $('#owners-head').hidden = $('#owner-results').hidden = !owners;
      if (owners) renderOwners();
      $('.views').scrollTop = 0;
    });
  }
  // Groups the plots in the list (or the selected ones) by owner: only what matches is counted.
  function renderOwners() {
    const fromSel = state.sel.size > 0;
    const rows = fromSel ? [...state.sel].map((id) => state.byId.get(id)).filter(Boolean) : state.matched;
    const q = norm($('#owners-filter').value.trim());
    const qDigits = $('#owners-filter').value.replace(/\D/g, '');
    const kinds = new Set([...document.querySelectorAll('#owners-kinds input:checked')].map((c) => c.value));
    const sort = $('#owners-sort').value;
    const agg = new Map();
    let personPlots = 0;
    for (const r of rows) {
      if (r.cat === 'person' || r.cat === 'mixed') personPlots++;
      for (const e of state.entitiesByPlot.get(r.id) || []) {
        let a = agg.get(e);
        if (!a) agg.set(e, (a = { e, n: 0, area: 0, free: 0 }));
        a.n++;
        a.area += r.area || 0;
        if (r.status === 'free' || r.status === 'partial') a.free += r.area || 0;
      }
    }
    let list = [...agg.values()].filter(({ e }) => kinds.has(e.kind === 'Община' || e.kind === 'Държавата' ? e.kind : 'firm')
      && (!q || (qDigits.length >= 4 && e.eik && e.eik.startsWith(qDigits)) || q.split(' ').every((t) => e.qn.includes(t))));
    list.sort((a, b) => (sort === 'count' ? b.n - a.n || b.area - a.area : b.area - a.area));
    const of = fromSel ? `${nf.format(rows.length)}-те избрани парцела` : `${nf.format(rows.length)} парцела в списъка`;
    $('#owners-count').innerHTML = `<b>${nf.format(list.length)}</b> ${list.length === 1 ? 'собственик' : 'собственика'} на ${of}`
      + (personPlots ? ` · ${nf.format(personPlots)} парцела са на физически лица (без имена)` : '')
      + (list.length > 200 ? '<br>Показани са първите 200.' : '');
    const ol = $('#owner-results');
    ol.innerHTML = '';
    const frag = document.createDocumentFragment();
    list.slice(0, 200).forEach(({ e, n, area, free }) => {
      const li = document.createElement('li');
      const allN = e.ids.length;
      li.innerHTML = `<div class="main">
          <div class="line1"><span class="oname">${esc(e.name)}</span><span class="area">${ha(area)} ха</span></div>
          <div class="chips">
            <span class="chip-s plain">${nf.format(n)}${n < allN ? ` от ${nf.format(allN)}` : ''} ${allN === 1 ? 'парцел' : 'парцела'}</span>
            ${free ? `<span class="chip-s" style="--c:${STATUS.free.color}">${ha(free)} ха незастроени/частично</span>` : ''}
            ${e.eik ? `<span class="chip-s plain">ЕИК ${esc(e.eik)}</span>` : ''}
          </div>
        </div><span class="go">›</span>`;
      li.addEventListener('click', () => chooseEntity(e));
      frag.appendChild(li);
    });
    ol.appendChild(frag);
    if (!list.length) ol.innerHTML = `<li class="empty">${rows.length ? 'Няма фирми или институции сред собствениците.' : 'Няма парцели в списъка.'}</li>`;
  }

  // ---------- Search ----------
  const sug = { items: [], hl: -1 };
  function initSearch() {
    const input = $('#search');
    let t;
    input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => suggest(input.value), 120); });
    input.addEventListener('focus', () => { if (input.value.trim()) suggest(input.value); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!sug.items.length) return;
        sug.hl = (sug.hl + (e.key === 'ArrowDown' ? 1 : -1) + sug.items.length) % sug.items.length;
        document.querySelectorAll('#suggest button').forEach((b, i) => b.classList.toggle('hl', i === sug.hl));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const pick = sug.items[Math.max(sug.hl, 0)];
        if (pick && (sug.hl >= 0 || pick.kind === 'entity')) pick.go();
        else if (input.value.trim()) searchText(input.value.trim());
      }
    });
    document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.search-wrap')) hideSuggest(); });
  }
  function hideSuggest() { $('#suggest').hidden = true; sug.hl = -1; }

  function findEntities(q, limit = 8) {
    const digits = q.replace(/\D/g, '');
    if (digits.length >= 4 && digits.length === q.replace(/\s/g, '').length) {
      return state.entities.filter((e) => e.eik && e.eik.startsWith(digits)).slice(0, limit);
    }
    const tokens = norm(q).split(' ').filter(Boolean);
    if (!tokens.length) return [];
    const scored = [];
    for (const e of state.entities) {
      if (!tokens.every((t) => e.qn.includes(t))) continue;
      let score = Math.log(1 + e.ids.length);
      if (e.qn.startsWith(tokens[0])) score += 4;
      if (tokens.every((t) => (' ' + e.qn).includes(' ' + t))) score += 2;
      scored.push([score, e]);
    }
    return scored.sort((a, b) => b[0] - a[0]).slice(0, limit).map((x) => x[1]);
  }
  function highlight(name, q) {
    const tokens = norm(q).split(' ').filter((t) => t.length > 1);
    let out = esc(name);
    for (const t of tokens) {
      const i = norm(name, true).indexOf(t);
      if (i < 0) continue;
      // Highlight by searching the raw name case-insensitively for the Cyrillic token.
      const re = new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      out = out.replace(re, (m) => `<mark>${m}</mark>`);
    }
    return out;
  }
  function suggest(raw) {
    const q = raw.trim();
    const box = $('#suggest');
    sug.items = [];
    sug.hl = -1;
    if (q.length < 2) { box.hidden = true; return; }
    const ents = findEntities(q);
    const plotHits = /\d/.test(q) ? state.rows.filter((r) => r.id.includes(q)).slice(0, 5) : [];
    let html = '';
    if (ents.length) {
      html += '<h4>Собственици</h4>';
      ents.forEach((e) => {
        sug.items.push({ kind: 'entity', go: () => chooseEntity(e) });
        html += `<button type="button" role="option"><span class="s-name">${highlight(e.name, q)}</span>
          <span class="s-n">${nf.format(e.ids.length)} парц.</span>
          <span class="s-meta">${e.eik ? 'ЕИК ' + esc(e.eik) + ' · ' : ''}${esc(e.kind)} · ${ha(e.area)} ха</span></button>`;
      });
    }
    if (plotHits.length) {
      html += '<h4>Парцели</h4>';
      plotHits.forEach((r) => {
        sug.items.push({ kind: 'plot', go: () => { hideSuggest(); openDetail(r.id, true); } });
        html += `<button type="button" role="option"><span class="s-name">${cad(r.id)}</span><span class="s-n">${num(r.area, ' м²')}</span>
          <span class="s-meta">${esc(r.owner)}</span></button>`;
      });
    }
    sug.items.push({ kind: 'text', go: () => searchText(q) });
    html += `<h4>Всички парцели</h4><button type="button" role="option"><span class="s-name">Търси „${esc(q)}“ в собствениците</span><span class="s-n">Enter</span></button>`;
    box.innerHTML = html;
    box.querySelectorAll('button').forEach((b, i) => b.addEventListener('click', () => sug.items[i].go()));
    box.hidden = false;
  }
  // A company narrows the plots that pass the filters; `all` shows every plot it owns.
  function chooseEntity(e, all = false) {
    hideSuggest();
    state.entity = e;
    state.text = '';
    state.searchAll = all;
    $('#search').value = e.name;
    setListMode('plots');
    apply();
    if (!all && !state.matched.length && state.scope.total) {
      state.searchAll = true;
      apply();
      toast(`Филтрите скриват парцелите на ${e.name} — показани са всичките ${nf.format(state.scope.total)}`);
    }
    setTab('list');
    fitRows(state.matched);
  }
  function searchText(q) {
    state.text = q;
    state.entity = null;
    state.searchAll = false;
    hideSuggest();
    setListMode('plots');
    apply();
    if (!state.matched.length && state.scope.total) { state.searchAll = true; apply(); toast('Филтрите скриват резултатите — показани са всички'); }
    setTab('list');
  }
  function setListMode(v) {
    const input = $('#list-mode');
    if (input.value === v) return;
    input.value = v;
    input.dispatchEvent(new Event('sync'));
    input.dispatchEvent(new Event('change'));
  }
  function clearSearch() {
    state.entity = null;
    state.text = '';
    state.searchAll = false;
    $('#search').value = '';
    apply();
  }

  // ---------- Export and sharing ----------
  function exportCsv(rows, name) {
    if (!rows.length) return toast('Няма какво да се експортира');
    const head = ['Идентификатор', 'Площ м²', 'Район', 'Зона ОУП', 'Състояние', 'Вид собственик', 'Собственик',
      'Макс. РЗП м²', 'Застроеност %', 'Бележка', 'Google Maps'];
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = rows.map((r) => [r.id, r.area, r.district, r.zone, STATUS[r.status].label, OWNER[r.cat].short, r.owner,
      r.max_floor || '', r.built, state.favs.get(r.id)?.note || '', `https://www.google.com/maps?q=${r.lat},${r.lon}`].map(cell).join(';'));
    const blob = new Blob(['﻿' + [head.map(cell).join(';'), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `parceli-varna-${name}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast(`Експортирани ${nf.format(rows.length)} парцела`);
  }
  function shareLink(ids) {
    if (!ids.length) return toast('Няма парцели за споделяне');
    const short = ids.map((id) => id.replace(/^10135\./, ''));
    copy(`${location.origin}${location.pathname}#ids=${short.join(',')}`, `Линк към ${ids.length} парцела е копиран`);
  }
  function copy(text, msg) {
    const done = () => toast(msg);
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, () => prompt('Копирайте:', text));
    else prompt('Копирайте:', text);
  }

  // ---------- Map tools ----------
  const rect = { active: false, start: null, shape: null, endedAt: 0 };
  function setHint(text) {
    banner.hidden = !text;
    banner.querySelector('.mb-text').textContent = text || '';
    document.body.classList.toggle('selecting', state.markMode || state.sel.size > 0);
  }
  banner.querySelector('.mb-done').onclick = () => {
    if (rect.active) stopRect();
    if (state.markMode) $('#tool-mark').click();
    setHint('');
  };
  function initLayersPanel() {
    document.querySelectorAll('[data-base]').forEach((b) => {
      b.onclick = () => {
        Object.values(BASES).forEach((t) => t.remove());
        BASES[b.dataset.base].addTo(map);
        document.querySelectorAll('[data-base]').forEach((x) => x.setAttribute('aria-pressed', x === b));
      };
    });
    document.querySelectorAll('[data-layer]').forEach((cb) => {
      cb.onchange = () => (cb.checked ? OVERLAYS[cb.dataset.layer].addTo(map) : OVERLAYS[cb.dataset.layer].remove());
    });
    // Map settings live on the map, next to the layers button, so the panel stays where it is.
    const pop = $('#layers-pop');
    map.getContainer().appendChild(pop);
    L.DomEvent.disableClickPropagation(pop);
    L.DomEvent.disableScrollPropagation(pop);
    const btn = $('#tool-layers');
    const show = (open) => {
      if (open) {   // open to the left of the button, aligned with its top
        const m = map.getContainer().getBoundingClientRect(), b = btn.getBoundingClientRect();
        pop.style.top = `${b.top - m.top}px`;
        pop.style.right = `${m.right - b.left + 8}px`;
      }
      pop.hidden = !open;
      btn.classList.toggle('on', open);
      btn.setAttribute('aria-expanded', open);
    };
    btn.onclick = () => show(pop.hidden);
    pop.querySelector('.lp-close').onclick = () => show(false);
    document.addEventListener('pointerdown', (e) => { if (!pop.hidden && !e.target.closest('#layers-pop, #tool-layers')) show(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) show(false); });
  }
  function renderThemeButton() {
    const b = $('#tool-theme');
    const dark = isDark();
    b.innerHTML = dark ? ICON.sun : ICON.moon;
    b.title = dark ? 'Светла тема' : 'Тъмна тема';
    b.setAttribute('aria-label', b.title);
  }
  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    store.set('varna-plots:theme', theme);
    document.querySelector('meta[name=theme-color]').content = theme === 'dark' ? '#131b20' : '#fbfcfc';
    renderThemeButton();
    // Canvas colours are read from the theme, so redraw the plots.
    renderDots();
    plots.eachLayer((l) => l.setStyle(polyStyle(l.feature.properties.id)));
    renderLegend();
  }
  function initTools() {
    renderThemeButton();
    $('#tool-theme').onclick = () => setTheme(isDark() ? 'light' : 'dark');
    $('#tool-locate').onclick = () => {
      map.locate({ setView: false, enableHighAccuracy: true });
      toast('Търсене на местоположението…');
    };
    let me;
    map.on('locationfound', (e) => {
      if (me) me.remove();
      me = L.circleMarker(e.latlng, { radius: 8, color: '#fff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 }).addTo(map);
      focusOn(e.latlng.lat, e.latlng.lng, 17);
    });
    map.on('locationerror', () => toast('Местоположението не е достъпно'));
    $('#tool-fit').onclick = () => fitRows(state.matched.slice(0, MAX_DOTS));
    // Back to the start: no search, nothing selected, the whole city. The filters stay as they are.
    $('#tool-reset').onclick = () => {
      if (rect.active) stopRect();
      if (state.markMode) $('#tool-mark').click();
      setHint('');
      if (state.current) closeDetail();
      if (state.sel.size) { const ids = [...state.sel]; state.sel.clear(); restyle(ids); renderSelection(); }
      if (state.entity || state.text) clearSearch();
      if (state.tab === 'detail') setTab('list');
      map.flyTo(HOME.center, HOME.zoom, { duration: 0.6 });
      toast('Начален изглед · филтрите са запазени');
    };
    $('#tool-mark').onclick = () => {
      state.markMode = !state.markMode;
      $('#tool-mark').classList.toggle('on', state.markMode);
      setHint(state.markMode ? 'Маркиране: докосвайте парцели, за да ги изберете' : '');
    };
    $('#tool-rect').onclick = () => (rect.active ? stopRect() : startRect());

    const el = map.getContainer();
    el.addEventListener('pointerdown', (e) => {
      if (!rect.active || e.target.closest('.leaflet-control')) return;
      e.preventDefault();
      rect.start = map.mouseEventToLatLng(e);
      rect.shape = L.rectangle([rect.start, rect.start], { color: '#2563eb', weight: 2, dashArray: '5 4', fillOpacity: 0.08, interactive: false }).addTo(map);
      el.setPointerCapture?.(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!rect.active || !rect.start) return;
      rect.shape.setBounds([rect.start, map.mouseEventToLatLng(e)]);
    });
    el.addEventListener('pointerup', (e) => {
      if (!rect.active || !rect.start) return;
      const b = L.latLngBounds(rect.start, map.mouseEventToLatLng(e));
      rect.shape.remove();
      rect.start = null;
      rect.endedAt = Date.now();
      const hits = state.matched.filter((r) => b.contains([r.lat, r.lon]));
      hits.forEach((r) => state.sel.add(r.id));
      stopRect();
      renderSelection();
      toast(hits.length ? `Избрани ${nf.format(hits.length)} парцела (от показаните)` : 'В правоъгълника няма показани парцели');
    });
  }
  function startRect() {
    rect.active = true;
    map.dragging.disable();
    map.getContainer().classList.add('drawing');
    map.getContainer().style.touchAction = 'none';
    $('#tool-rect').classList.add('on');
    setHint('Начертайте правоъгълник върху картата');
  }
  function stopRect() {
    rect.active = false;
    map.dragging.enable();
    map.getContainer().classList.remove('drawing');
    map.getContainer().style.touchAction = '';
    $('#tool-rect').classList.remove('on');
    setHint(state.markMode ? 'Маркиране: докосвайте парцели, за да ги изберете' : '');
  }

  // ---------- Phone bottom sheet ----------
  const sheet = { state: 'half' };
  function sheetHeights() {
    const vh = window.innerHeight;
    const peek = ($('#sheet-handle').offsetHeight || 20) + document.querySelector('#panel header').offsetHeight
      + (!$('#selbar').hidden ? $('#selbar').offsetHeight : 0);
    const top = topHeight();
    return { peek: Math.min(peek, vh * 0.45), half: Math.round(Math.min(vh * 0.52, vh - top - 140)), full: vh - top - 8 };
  }
  function topHeight() { return isPhone() ? ($('#topbar').offsetHeight || 0) : 0; }
  function sheetHeight() { return isPhone() ? sheetHeights()[sheet.state] : 0; }
  function snapSheet(to) {
    sheet.state = to;
    applySheet();
  }
  function applySheet(px) {
    const root = document.documentElement;
    if (!isPhone()) { root.style.setProperty('--sheet-h', '0px'); $('#panel').style.height = ''; return; }
    const h = px ?? sheetHeights()[sheet.state];
    root.style.setProperty('--sheet-h', h + 'px');
    $('#panel').classList.remove('sheet-peek', 'sheet-half', 'sheet-full');
    $('#panel').classList.add('sheet-' + sheet.state);
  }
  function updateSheetForSelbar() { if (isPhone() && sheet.state === 'peek') applySheet(); }
  function syncTopHeight() {
    document.documentElement.style.setProperty('--top-h', ($('#topbar').offsetHeight || 0) + 'px');
  }
  if (window.ResizeObserver) new ResizeObserver(syncTopHeight).observe($('#topbar'));
  function initSheet() {
    const panel = $('#panel');
    const grab = [$('#sheet-handle'), document.querySelector('#panel header')];
    let startY = 0, startH = 0, moved = false, dragging = false;
    const onDown = (e) => {
      if (!isPhone() || e.target.closest('input, button, .suggest, select, a')) return;
      dragging = true; moved = false; startY = e.clientY; startH = panel.offsetHeight;
      panel.classList.add('dragging');
      e.currentTarget.setPointerCapture?.(e.pointerId);
    };
    const onMove = (e) => {
      if (!dragging) return;
      const dy = startY - e.clientY;
      if (Math.abs(dy) > 4) moved = true;
      const h = Math.max(80, Math.min(window.innerHeight - 40, startH + dy));
      applySheet(h);
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      panel.classList.remove('dragging');
      const hs = sheetHeights();
      const h = panel.offsetHeight;
      if (!moved) {
        sheet.state = { peek: 'half', half: 'full', full: 'peek' }[sheet.state];
      } else {
        sheet.state = Object.entries(hs).sort((a, b) => Math.abs(a[1] - h) - Math.abs(b[1] - h))[0][0];
      }
      applySheet();
    };
    grab.forEach((g) => {
      g.addEventListener('pointerdown', onDown);
      g.addEventListener('pointermove', onMove);
      g.addEventListener('pointerup', onUp);
      g.addEventListener('pointercancel', onUp);
    });
    $('#search').addEventListener('focus', () => { if (isPhone() && sheet.state === 'peek') snapSheet('half'); });
    document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
      if (isPhone() && sheet.state === 'peek') snapSheet('half');
    }));
    syncTopHeight();
    window.addEventListener('resize', () => { applySheet(); map.invalidateSize(); });
    applySheet();
  }

  // Start on the filters tab (the data load switches to the right one).
  initSearch();
  initTools();
  initLayersPanel();
  initSheet();
  setTab('filters');
})();
