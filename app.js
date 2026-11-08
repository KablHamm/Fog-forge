/* ═══════════════════════════════════════════════════════════════════════════
   FOGFORGE — Trial Grounds Cartographer
   A self-contained top-down CAD-style editor for Dead by Daylight maps.
   ═══════════════════════════════════════════════════════════════════════════ */

(() => {
  'use strict';

  // ── Utilities ────────────────────────────────────────────────────────────

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const DEG = Math.PI / 180;
  const TAU = Math.PI * 2;
  const STORAGE_KEY = 'fogforge.document.v1';
  const BASE_ZOOM = 16;

  const formatNum = (value, decimals = 2) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return '0';
    return n.toFixed(decimals).replace(/\.?0+$/, '') || '0';
  };

  const roundTo = (value, step) => Math.round(value / step) * step;
  const normalizeAngle = (angle) => ((angle % 360) + 360) % 360;
  const normalizeRad = (angle) => ((angle % TAU) + TAU) % TAU;
  const deepClone = (value) => JSON.parse(JSON.stringify(value));
  const escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));

  const uid = (() => {
    let count = 0;
    return (prefix = 'e') => `${prefix}_${Date.now().toString(36)}_${(count++).toString(36)}`;
  })();

  const hexToRgba = (hex, alpha = 1) => {
    if (!hex || typeof hex !== 'string') return `rgba(200, 190, 170, ${alpha})`;
    const clean = hex.replace('#', '');
    if (clean.length !== 6) return hex;
    const n = parseInt(clean, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  };

  const isTypingTarget = (target) => {
    if (!target) return false;
    const tag = target.tagName?.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
  };

  const downloadBlob = (blob, filename) => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1200);
  };

  const downloadText = (text, filename, type = 'text/plain') => {
    downloadBlob(new Blob([text], { type }), filename);
  };

  const slugify = (text) => String(text || 'trial-grounds')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'trial-grounds';

  // ── Constants ────────────────────────────────────────────────────────────

  const REALMS = [
    'Macmillan Estate', 'Coldwind Farm', 'Autohaven Wreckers', 'Crotus Prenn Asylum',
    "Léry's Memorial Institute", 'Gideon Meat Plant', 'Yamaoka Estate', 'Red Forest',
    'Ormond', 'Hawkins National Laboratory', 'Haddonfield', 'Raccoon City',
    'Silent Hill', 'Grave of Glenvale', 'Dvarka Deepwood', 'Other realm'
  ];

  const DEFAULT_LAYERS = () => ([
    { id: 'structure', name: 'Structure', color: '#897b67', visible: true, locked: false },
    { id: 'walls', name: 'Walls & Fences', color: '#c5b49d', visible: true, locked: false },
    { id: 'props', name: 'Props & Loops', color: '#7ed8cf', visible: true, locked: false },
    { id: 'labels', name: 'Annotations', color: '#b1aa9d', visible: true, locked: false }
  ]);

  const MARKERS = {
    pallet:    { name: 'Pallet',      icon: 'i-pallet',    color: '#d19057' },
    vault:     { name: 'Vault',       icon: 'i-vault',     color: '#82bfd1' },
    generator: { name: 'Generator',   icon: 'i-generator', color: '#d9b55d' },
    hook:      { name: 'Hook',        icon: 'i-hook',      color: '#cf7968' },
    totem:     { name: 'Totem',       icon: 'i-totem',     color: '#a88bd4' },
    chest:     { name: 'Chest',       icon: 'i-chest',     color: '#c59a62' },
    hatch:     { name: 'Hatch',       icon: 'i-hatch',     color: '#7ed8cf' },
    gate:      { name: 'Exit Gate',   icon: 'i-gate',      color: '#dfa05f' },
    basement:  { name: 'Basement',    icon: 'i-basement',  color: '#bd746b' },
    stairs:    { name: 'Stairs',      icon: 'i-stairs',    color: '#b0a68f' },
    locker:    { name: 'Locker',      icon: 'i-locker',    color: '#91a5a3' }
  };

  const TOOLS = {
    select: { name: 'Select', shortcut: 'V', icon: 'i-cursor', desc: 'Pick, move and refine objects on the blueprint.' },
    pan: { name: 'Pan', shortcut: 'H', icon: 'i-hand', desc: 'Drag the sheet. Hold Space with any tool for the same result.' },
    line: { name: 'Line', shortcut: 'L', icon: 'i-line', desc: 'Chain independent CAD line segments. Enter or right-click to finish.' },
    polyline: { name: 'Polyline', shortcut: 'P', icon: 'i-polyline', desc: 'Draw one connected path. Close it by clicking the first node.' },
    rect: { name: 'Rectangle', shortcut: 'R', icon: 'i-rect', desc: 'Two clicks define opposite corners. Hold Shift for a perfect square.' },
    circle: { name: 'Circle', shortcut: 'C', icon: 'i-circle', desc: 'Click the centre, then click to set the radius.' },
    ellipse: { name: 'Ellipse', shortcut: 'E', icon: 'i-ellipse', desc: 'Two clicks define a bounding box. Hold Shift to constrain it.' },
    polygon: { name: 'Polygon', shortcut: 'G', icon: 'i-polygon', desc: 'Click the centre, then set radius and rotation in one motion.' },
    arc: { name: '3-point Arc', shortcut: 'A', icon: 'i-arc', desc: 'Click start, a point along the curve, then the end point.' },
    wall: { name: 'Wall', shortcut: 'W', icon: 'i-wall', desc: 'Chain wall segments with a live thickness. Click the first node to close.' },
    text: { name: 'Label', shortcut: 'T', icon: 'i-text', desc: 'Place a cartographic annotation on the map.' },
    marker: { name: 'Marker', shortcut: 'M', icon: 'i-marker', desc: 'Stamp a trial prop, landmark or objective marker.' },
    measure: { name: 'Measure', shortcut: 'U', icon: 'i-ruler', desc: 'Pull a temporary dimension between two points.' }
  };

  const TOOL_LAYER = {
    line: 'structure', polyline: 'structure', rect: 'structure', circle: 'structure',
    ellipse: 'structure', polygon: 'structure', arc: 'structure', wall: 'walls',
    text: 'labels', marker: 'props'
  };

  const SHAPE_TYPES = new Set(['rect', 'circle', 'ellipse', 'polygon']);
  const PATH_TYPES = new Set(['polyline', 'wall']);
  const TYPE_LABEL = {
    polyline: 'Polyline', wall: 'Wall chain', rect: 'Rectangle', circle: 'Circle',
    ellipse: 'Ellipse', polygon: 'Polygon', arc: 'Arc', text: 'Annotation',
    marker: 'Prop marker', measure: 'Dimension'
  };

  const TYPE_ICON = {
    polyline: 'i-polyline', wall: 'i-wall', rect: 'i-rect', circle: 'i-circle',
    ellipse: 'i-ellipse', polygon: 'i-polygon', arc: 'i-arc', text: 'i-text',
    marker: 'i-marker', measure: 'i-ruler'
  };

  // ── Preset template helpers ─────────────────────────────────────────────

  const tplFloor = (x, y, w, h, opts = {}) => ({
    type: 'rect', layer: 'structure', name: opts.name || 'Floor footprint',
    x, y, w, h, rotation: opts.rotation || 0,
    stroke: opts.stroke || '#897b67', strokeWidth: opts.strokeWidth ?? 0,
    fill: opts.fill || '#887760', filled: true,
    opacity: opts.opacity ?? 0.13, dash: 'solid'
  });

  const tplPoly = (points, opts = {}) => ({
    type: 'polyline', layer: opts.layer || 'structure', name: opts.name || 'Outline',
    points: points.map((p) => [...p]), closed: opts.closed ?? false,
    stroke: opts.stroke || '#c5b49d', strokeWidth: opts.strokeWidth ?? 0.12,
    fill: opts.fill || '#887760', filled: opts.filled ?? false,
    opacity: opts.opacity ?? 1, dash: opts.dash || 'solid', rotation: 0
  });

  const tplWall = (x1, y1, x2, y2, opts = {}) => ({
    type: 'wall', layer: 'walls', name: opts.name || 'Wall',
    points: [[x1, y1], [x2, y2]], closed: opts.closed ?? false,
    thickness: opts.thickness || 0.32, stroke: opts.stroke || '#c6b59e',
    strokeWidth: opts.thickness || 0.32, fill: '#000000', filled: false,
    opacity: opts.opacity ?? 1, dash: opts.dash || 'solid', rotation: 0
  });

  const tplRect = (x, y, w, h, opts = {}) => ({
    type: 'rect', layer: opts.layer || 'structure', name: opts.name || 'Rectangle',
    x, y, w, h, rotation: opts.rotation || 0,
    stroke: opts.stroke || '#c5b49d', strokeWidth: opts.strokeWidth ?? 0.1,
    fill: opts.fill || '#887760', filled: opts.filled ?? false,
    opacity: opts.opacity ?? 1, dash: opts.dash || 'solid'
  });

  const tplCircle = (cx, cy, r, opts = {}) => ({
    type: 'circle', layer: opts.layer || 'structure', name: opts.name || 'Circle',
    cx, cy, r, rotation: 0,
    stroke: opts.stroke || '#c5b49d', strokeWidth: opts.strokeWidth ?? 0.1,
    fill: opts.fill || '#887760', filled: opts.filled ?? false,
    opacity: opts.opacity ?? 1, dash: opts.dash || 'solid'
  });

  const arcPoints = (cx, cy, r, a0, a1) => {
    const mid = (a0 + a1) / 2;
    return [a0, mid, a1].map((a) => [cx + Math.cos(a * DEG) * r, cy + Math.sin(a * DEG) * r]);
  };

  const tplArc = (cx, cy, r, a0, a1, opts = {}) => ({
    type: 'arc', layer: opts.layer || 'walls', name: opts.name || 'Door swing',
    points: arcPoints(cx, cy, r, a0, a1),
    stroke: opts.stroke || '#8f806d', strokeWidth: opts.strokeWidth ?? 0.055,
    fill: '#000000', filled: false,
    opacity: opts.opacity ?? 0.34, dash: opts.dash || 'solid', rotation: 0
  });

  const tplLabel = (text, x, y, size = 0.75, opts = {}) => ({
    type: 'text', layer: 'labels', name: text,
    x, y, text, fontSize: size, rotation: opts.rotation || 0,
    color: opts.color || '#b9b3a6', opacity: opts.opacity ?? 0.55,
    stroke: '#000000', strokeWidth: 0, filled: false, fill: '#000000', dash: 'solid'
  });

  const tplMarker = (x, y, markerType, opts = {}) => ({
    type: 'marker', layer: 'props', name: MARKERS[markerType]?.name || 'Marker',
    x, y, markerType, size: opts.size || 1.8, rotation: opts.rotation || 0,
    color: opts.color || MARKERS[markerType]?.color || '#7ed8cf',
    opacity: opts.opacity ?? 1, stroke: '#000000', strokeWidth: 0,
    filled: false, fill: '#000000', dash: 'solid'
  });

  // ── Structure presets ───────────────────────────────────────────────────

  const PRESETS = [
    {
      id: 'main-building',
      name: 'Main Building',
      tag: 'Macmillan / multi-room',
      category: 'building',
      sizeLabel: '34 × 22 m',
      description: 'A two-storey, multi-room main building footprint with twin stairwells, pallet and vault windows.',
      objects: [
        tplFloor(0, 0, 34, 22, { opacity: 0.14 }),
        // Exterior walls — gaps are doors and vault windows.
        tplWall(0, 0, 7.5, 0, { thickness: 0.42 }),
        tplWall(10, 0, 20, 0, { thickness: 0.42 }),
        tplWall(22, 0, 34, 0, { thickness: 0.42 }),
        tplWall(34, 0, 34, 5.3, { thickness: 0.42 }),
        tplWall(34, 7, 34, 13, { thickness: 0.42 }),
        tplWall(34, 14.3, 34, 22, { thickness: 0.42 }),
        tplWall(0, 22, 8, 22, { thickness: 0.42 }),
        tplWall(10, 22, 22, 22, { thickness: 0.42 }),
        tplWall(24, 22, 34, 22, { thickness: 0.42 }),
        tplWall(0, 0, 0, 4, { thickness: 0.42 }),
        tplWall(0, 5.4, 0, 16, { thickness: 0.42 }),
        tplWall(0, 17.5, 0, 22, { thickness: 0.42 }),
        // Interior partitions.
        tplWall(0, 7, 3.5, 7),
        tplWall(4.7, 7, 9, 7),
        tplWall(10.2, 7, 16, 7),
        tplWall(17.2, 7, 22.5, 7),
        tplWall(23.7, 7, 34, 7),
        tplWall(9, 0, 9, 3.2),
        tplWall(9, 4.4, 9, 7),
        tplWall(22, 0, 22, 4),
        tplWall(22, 5.2, 22, 7),
        tplWall(0, 13.5, 5, 13.5),
        tplWall(6.2, 13.5, 12, 13.5),
        tplWall(13.2, 13.5, 22, 13.5),
        tplWall(23.2, 13.5, 34, 13.5),
        tplWall(12, 13.5, 12, 17),
        tplWall(12, 18.2, 12, 22),
        tplWall(22, 13.5, 22, 16.4),
        tplWall(22, 17.6, 22, 22),
        // Central stair hall.
        tplWall(15.8, 7, 15.8, 9),
        tplWall(15.8, 10.2, 15.8, 13.5),
        tplWall(18.6, 7, 18.6, 9),
        tplWall(18.6, 10.2, 18.6, 13.5),
        // Door swings.
        tplArc(10, 0, 2.2, 90, 180),
        tplArc(8, 22, 2.2, 180, 270),
        tplArc(0, 16, 2.2, 0, 90),
        // Feature markers.
        tplMarker(21, 0, 'vault', { size: 1.8 }),
        tplMarker(34, 13.65, 'vault', { size: 1.8, rotation: 90 }),
        tplMarker(0, 4.7, 'vault', { size: 1.8, rotation: 90 }),
        tplMarker(20.2, 8.1, 'pallet', { size: 2.1, rotation: 0 }),
        tplMarker(17.2, 10.4, 'stairs', { size: 2.4 }),
        tplMarker(25.4, 10.4, 'stairs', { size: 2.4 }),
        tplMarker(29.4, 18.2, 'chest', { size: 1.7 }),
        tplLabel('MAIN BUILDING', 17, 4.2, 0.9, { opacity: 0.22 }),
        tplLabel('STAIRS', 17.2, 12.3, 0.5, { opacity: 0.42 }),
        tplLabel('HALL', 17.2, 18.2, 0.55, { opacity: 0.3 })
      ]
    },
    {
      id: 'killer-shack',
      name: 'Killer Shack',
      tag: 'Universal / basement',
      category: 'building',
      sizeLabel: '12 × 10 m',
      description: 'The classic killer shack: central basement, door pallet, side window and two entry gaps.',
      objects: [
        tplFloor(0, 0, 12, 10, { opacity: 0.16 }),
        tplWall(0, 0, 4.2, 0, { thickness: 0.38 }),
        tplWall(5.8, 0, 12, 0, { thickness: 0.38 }),
        tplWall(12, 0, 12, 3.4, { thickness: 0.38 }),
        tplWall(12, 5.2, 12, 10, { thickness: 0.38 }),
        tplWall(0, 10, 4.6, 10, { thickness: 0.38 }),
        tplWall(6.4, 10, 12, 10, { thickness: 0.38 }),
        tplWall(0, 0, 0, 10, { thickness: 0.38 }),
        tplArc(4.6, 10, 1.8, 180, 270),
        tplArc(12, 5.2, 1.8, 0, 90),
        tplMarker(5, 0, 'vault', { size: 1.9 }),
        tplMarker(5.5, 8.8, 'pallet', { size: 2.2 }),
        tplMarker(8.15, 6.3, 'basement', { size: 2.4 }),
        tplMarker(2.1, 2.1, 'chest', { size: 1.45 }),
        tplLabel('KILLER SHACK', 6, 4.4, 0.8, { opacity: 0.2 }),
        tplLabel('BASEMENT', 8.2, 7.9, 0.42, { opacity: 0.45 })
      ]
    },
    {
      id: 'harvester',
      name: 'Harvester',
      tag: 'Coldwind / main loop',
      category: 'loop',
      sizeLabel: '18 × 14 m',
      description: 'A harvester loop with a machine centrepiece, partial walls, pallet and vault window.',
      objects: [
        tplFloor(0, 0, 18, 14, { opacity: 0.08 }),
        // The machine.
        tplRect(6, 5.2, 6.4, 3.1, { name: 'Harvester body', fill: '#7b5138', stroke: '#b9835b', strokeWidth: 0.12, filled: true, opacity: 0.5 }),
        tplRect(5.4, 8.3, 7.6, 1.15, { name: 'Harvester header', fill: '#66442f', stroke: '#b9835b', strokeWidth: 0.11, filled: true, opacity: 0.48 }),
        tplRect(8.6, 4.15, 2.3, 1.3, { name: 'Harvester cab', fill: '#68513e', stroke: '#b9835b', strokeWidth: 0.1, filled: true, opacity: 0.5 }),
        tplCircle(7.5, 8.4, 0.86, { name: 'Wheel', fill: '#282624', stroke: '#6d6257', strokeWidth: 0.1, filled: true, opacity: 0.8 }),
        tplCircle(10.9, 8.4, 0.86, { name: 'Wheel', fill: '#282624', stroke: '#6d6257', strokeWidth: 0.1, filled: true, opacity: 0.8 }),
        tplCircle(3.2, 9.6, 0.75, { name: 'Hay bale', fill: '#8d6e3c', stroke: '#b99a5f', strokeWidth: 0.07, filled: true, opacity: 0.28 }),
        tplCircle(3.6, 10.85, 0.6, { name: 'Hay bale', fill: '#8d6e3c', stroke: '#b99a5f', strokeWidth: 0.07, filled: true, opacity: 0.24 }),
        // Looping walls.
        tplWall(1, 1, 1, 12.5),
        tplWall(1, 1, 7, 1),
        tplWall(9, 1, 17, 1),
        tplWall(17, 1, 17, 6.2),
        tplWall(17, 7.6, 17, 12.5),
        tplWall(1, 12.5, 6, 12.5),
        tplWall(8.2, 12.5, 17, 12.5),
        tplArc(9, 1, 1.9, 90, 180),
        tplMarker(7, 12.5, 'pallet', { size: 2.2 }),
        tplMarker(17, 6.9, 'vault', { size: 1.8, rotation: 90 }),
        tplMarker(14.4, 10.9, 'generator', { size: 1.7 }),
        tplLabel('HARVESTER', 9, 3.2, 0.72, { opacity: 0.3 })
      ]
    },
    {
      id: 'jungle-gym',
      name: 'Jungle Gym',
      tag: 'Universal / vault loop',
      category: 'loop',
      sizeLabel: '16 × 9 m',
      description: 'A walled jungle gym with a central vault window, open doorway and pallet.',
      objects: [
        tplFloor(0, 0, 16, 9, { opacity: 0.07 }),
        tplWall(0, 0, 6.2, 0, { thickness: 0.34 }),
        tplWall(7.8, 0, 16, 0, { thickness: 0.34 }),
        tplWall(16, 0, 16, 9, { thickness: 0.34 }),
        tplWall(0, 9, 4, 9, { thickness: 0.34 }),
        tplWall(5.8, 9, 16, 9, { thickness: 0.34 }),
        tplWall(0, 0, 0, 9, { thickness: 0.34 }),
        // Central vault wall.
        tplWall(5.5, 4.5, 7.2, 4.5, { thickness: 0.3 }),
        tplWall(8.4, 4.5, 10.7, 4.5, { thickness: 0.3 }),
        tplWall(10.7, 4.5, 10.7, 7.6, { thickness: 0.3 }),
        tplArc(4, 9, 1.8, 180, 270),
        tplMarker(7, 0, 'vault', { size: 1.9 }),
        tplMarker(7.8, 4.5, 'vault', { size: 1.7, rotation: 90 }),
        tplMarker(4, 8.7, 'pallet', { size: 2.2 }),
        tplMarker(13.7, 2.1, 'generator', { size: 1.6 }),
        tplLabel('JUNGLE GYM', 8, 6.7, 0.72, { opacity: 0.25 })
      ]
    },
    {
      id: 't-wall',
      name: 'T-Wall',
      tag: 'Universal / pallet loop',
      category: 'loop',
      sizeLabel: '16 × 11 m',
      description: 'A clean T-wall loop with a central wall, pallet and a short cover wall.',
      objects: [
        tplFloor(0, 0, 16, 11, { opacity: 0.055 }),
        tplWall(1, 3, 15, 3, { thickness: 0.4 }),
        tplWall(8, 3, 8, 10.5, { thickness: 0.4 }),
        tplWall(1, 7.3, 4.8, 7.3, { thickness: 0.3 }),
        tplMarker(11.1, 4.2, 'pallet', { size: 2.3, rotation: 90 }),
        tplMarker(4.9, 8, 'vault', { size: 1.6, rotation: 0 }),
        tplLabel('T-WALL', 12.5, 9.6, 0.62, { opacity: 0.22 })
      ]
    },
    {
      id: 'lt-wall',
      name: 'L/T Wall',
      tag: 'Universal / mindgame',
      category: 'loop',
      sizeLabel: '15 × 10 m',
      description: 'The classic L-wall with a disconnected short wall and pallet gap.',
      objects: [
        tplFloor(0, 0, 15, 10, { opacity: 0.055 }),
        tplWall(1, 1, 9, 1, { thickness: 0.4 }),
        tplWall(1, 1, 1, 7, { thickness: 0.4 }),
        tplWall(11, 4.2, 14, 4.2, { thickness: 0.38 }),
        tplWall(9.6, 7.2, 9.6, 9.6, { thickness: 0.26 }),
        tplMarker(9.6, 4.3, 'pallet', { size: 2.25, rotation: 90 }),
        tplMarker(5.7, 7, 'vault', { size: 1.55 }),
        tplLabel('L / T WALL', 6, 8.8, 0.62, { opacity: 0.2 })
      ]
    },
    {
      id: 'cow-tree',
      name: 'Cow Tree',
      tag: 'Coldwind / tree loop',
      category: 'loop',
      sizeLabel: '14 × 14 m',
      description: 'The cow tree loop with a large central tree, bales, low cover and pallet.',
      objects: [
        tplFloor(0, 0, 14, 14, { opacity: 0.055 }),
        tplCircle(7, 7, 3.65, { name: 'Tree canopy', stroke: '#8b7d63', strokeWidth: 0.08, fill: '#5e523e', filled: true, opacity: 0.22, dash: 'dashed' }),
        tplCircle(7, 7, 2.55, { name: 'Tree canopy', stroke: '#9c8c6e', strokeWidth: 0.12, fill: '#4c4434', filled: true, opacity: 0.38 }),
        tplCircle(7, 7, 0.62, { name: 'Tree trunk', stroke: '#a49170', strokeWidth: 0.08, fill: '#594b38', filled: true, opacity: 0.9 }),
        tplCircle(2.1, 10.8, 0.72, { name: 'Bale', stroke: '#9e854f', strokeWidth: 0.06, fill: '#806834', filled: true, opacity: 0.3 }),
        tplCircle(3.3, 11.5, 0.55, { name: 'Bale', stroke: '#9e854f', strokeWidth: 0.06, fill: '#806834', filled: true, opacity: 0.27 }),
        tplWall(1.2, 8.2, 3.8, 9.4, { thickness: 0.28 }),
        tplWall(10.7, 9.2, 12.7, 7.8, { thickness: 0.28 }),
        tplMarker(10.4, 10.8, 'pallet', { size: 2.2 }),
        tplMarker(2.9, 3.2, 'totem', { size: 1.5 }),
        tplLabel('COW TREE', 7, 12.8, 0.66, { opacity: 0.24 })
      ]
    },
    {
      id: 'exit-gate',
      name: 'Exit Gate',
      tag: 'Universal / utility',
      category: 'utility',
      sizeLabel: '18 × 9 m',
      description: 'A two-post exit gate with switch notation, fence returns and open threshold.',
      objects: [
        tplFloor(0, 0, 18, 9, { opacity: 0.045 }),
        tplWall(0, 2, 5, 2, { thickness: 0.32 }),
        tplWall(13, 2, 18, 2, { thickness: 0.32 }),
        tplRect(5, 2, 1.2, 4.8, { name: 'Gate post', fill: '#594d3f', stroke: '#aa9a82', strokeWidth: 0.1, filled: true, opacity: 0.65 }),
        tplRect(11.8, 2, 1.2, 4.8, { name: 'Gate post', fill: '#594d3f', stroke: '#aa9a82', strokeWidth: 0.1, filled: true, opacity: 0.65 }),
        tplWall(6.2, 4.4, 11.8, 4.4, { thickness: 0.12, opacity: 0.55, dash: 'dashed' }),
        tplMarker(15, 3.2, 'gate', { size: 1.9 }),
        tplMarker(9, 6.9, 'hatch', { size: 1.4 }),
        tplPoly([[6.4, 7.4], [8.4, 8.4], [10.8, 8.4], [12.6, 7.4]], { layer: 'structure', stroke: '#897b67', strokeWidth: 0.06, dash: 'dashed', opacity: 0.24 }),
        tplLabel('EXIT GATE', 9, 1, 0.72, { opacity: 0.32 }),
        tplLabel('SWITCH', 15, 4.7, 0.42, { opacity: 0.38 })
      ]
    }
  ];

  // ── Document model & editor state ───────────────────────────────────────

  const canvas = $('#canvas');
  const ctx = canvas.getContext('2d');
  const stage = $('#stage');

  const state = {
    doc: null,
    camera: { x: 0, y: 0, zoom: 11 },
    view: { w: 0, h: 0, dpr: 1 },
    tool: 'select',
    activeLayer: 'structure',
    activeMarker: 'pallet',
    selection: new Set(),
    hoverEntity: null,
    hoverHandle: null,
    draft: null,
    drag: null,
    marquee: null,
    pan: null,
    pinch: null,
    touchPoints: new Map(),
    snap: null,
    pointerWorld: { x: 0, y: 0 },
    pointerScreen: { x: 0, y: 0 },
    handleAreas: [],
    spaceDown: false,
    isPanning: false,
    textPoint: null,
    frameRequested: false,
    lastPrompt: '',
    settings: {
      wallThickness: 0.32,
      polygonSides: 6,
      lineWeight: 0.12,
      fontSize: 1.1,
      markerSize: 1.8,
      keepActive: true
    }
  };

  const history = {
    undo: [],
    redo: [],
    last: '',
    limit: 80,
    timer: null
  };

  let underlayImage = null;
  let underlaySrc = '';
  let saveTimer = null;
  let toastTimer = 0;

  const createBlankDoc = (name = 'Untitled Trial Grounds', realm = 'Macmillan Estate') => ({
    version: 1,
    name,
    realm,
    entities: [],
    layers: DEFAULT_LAYERS(),
    image: null,
    gridSize: 1,
    showGrid: true,
    snapGrid: true,
    snapGeom: true,
    ortho: false,
    createdAt: Date.now(),
    updatedAt: Date.now()
  });

  const normalizeEntity = (entity) => {
    const e = { ...entity };
    e.id = e.id || uid('e');
    e.layer = e.layer || 'structure';
    e.name = e.name || TYPE_LABEL[e.type] || 'Object';
    e.stroke = e.stroke || '#c5b49d';
    e.strokeWidth = Number.isFinite(Number(e.strokeWidth)) ? Number(e.strokeWidth) : 0.1;
    e.fill = e.fill || '#887760';
    e.filled = Boolean(e.filled);
    e.opacity = Number.isFinite(Number(e.opacity)) ? clamp(Number(e.opacity), 0, 1) : 1;
    e.dash = e.dash || 'solid';
    e.rotation = Number.isFinite(Number(e.rotation)) ? Number(e.rotation) : 0;
    if (PATH_TYPES.has(e.type)) {
      e.points = Array.isArray(e.points) ? e.points.map((p) => [Number(p[0]), Number(p[1])]) : [];
      e.closed = Boolean(e.closed);
      if (e.type === 'wall') e.thickness = Number(e.thickness) || 0.32;
    }
    if (e.type === 'arc') {
      e.points = Array.isArray(e.points) ? e.points.map((p) => [Number(p[0]), Number(p[1])]) : [];
    }
    if (e.type === 'text') {
      e.text = e.text || 'LABEL';
      e.fontSize = Number(e.fontSize) || 0.9;
      e.color = e.color || '#b9b3a6';
    }
    if (e.type === 'marker') {
      e.markerType = MARKERS[e.markerType] ? e.markerType : 'pallet';
      e.size = Number(e.size) || 1.8;
      e.color = e.color || MARKERS[e.markerType].color;
    }
    if (e.type === 'rect') {
      e.x = Number(e.x) || 0; e.y = Number(e.y) || 0;
      e.w = Number(e.w) || 1; e.h = Number(e.h) || 1;
    }
    if (e.type === 'circle') {
      e.cx = Number(e.cx) || 0; e.cy = Number(e.cy) || 0; e.r = Number(e.r) || 1;
    }
    if (e.type === 'ellipse') {
      e.cx = Number(e.cx) || 0; e.cy = Number(e.cy) || 0;
      e.rx = Number(e.rx) || 1; e.ry = Number(e.ry) || 1;
    }
    if (e.type === 'polygon') {
      e.cx = Number(e.cx) || 0; e.cy = Number(e.cy) || 0;
      e.r = Number(e.r) || 1; e.sides = clamp(parseInt(e.sides, 10) || 6, 3, 16);
    }
    return e;
  };

  const normalizeDoc = (raw) => {
    const doc = createBlankDoc(raw?.name || 'Untitled Trial Grounds', raw?.realm || 'Macmillan Estate');
    doc.version = 1;
    doc.createdAt = raw?.createdAt || Date.now();
    doc.updatedAt = raw?.updatedAt || Date.now();
    doc.entities = Array.isArray(raw?.entities) ? raw.entities.map(normalizeEntity) : [];
    if (Array.isArray(raw?.layers) && raw.layers.length) {
      doc.layers = raw.layers.map((layer) => ({
        id: String(layer.id || uid('layer')),
        name: String(layer.name || 'Layer'),
        color: layer.color || '#8b8375',
        visible: layer.visible !== false,
        locked: Boolean(layer.locked)
      }));
    }
    const ids = new Set(doc.layers.map((l) => l.id));
    if (!ids.has('structure')) doc.layers.unshift(DEFAULT_LAYERS()[0]);
    if (!ids.has('walls')) doc.layers.splice(1, 0, DEFAULT_LAYERS()[1]);
    doc.image = raw?.image && raw.image.dataUrl ? {
      dataUrl: raw.image.dataUrl,
      name: raw.image.name || 'Reference image',
      x: Number(raw.image.x) || 0,
      y: Number(raw.image.y) || 0,
      w: Number(raw.image.w) || 40,
      h: Number(raw.image.h) || 30,
      opacity: Number.isFinite(Number(raw.image.opacity)) ? Number(raw.image.opacity) : 0.42,
      visible: raw.image.visible !== false
    } : null;
    doc.gridSize = [0.25, 0.5, 1, 2, 5].includes(Number(raw?.gridSize)) ? Number(raw.gridSize) : 1;
    doc.showGrid = raw?.showGrid !== false;
    doc.snapGrid = raw?.snapGrid !== false;
    doc.snapGeom = raw?.snapGeom !== false;
    doc.ortho = Boolean(raw?.ortho);
    return doc;
  };

  // ── Geometry helpers ────────────────────────────────────────────────────

  const rotatePoint = (x, y, cx, cy, angle) => {
    const a = angle * DEG;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const dx = x - cx;
    const dy = y - cy;
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
  };

  const rectCorners = (e) => {
    const cx = e.x + e.w / 2;
    const cy = e.y + e.h / 2;
    return [
      rotatePoint(e.x, e.y, cx, cy, e.rotation),
      rotatePoint(e.x + e.w, e.y, cx, cy, e.rotation),
      rotatePoint(e.x + e.w, e.y + e.h, cx, cy, e.rotation),
      rotatePoint(e.x, e.y + e.h, cx, cy, e.rotation)
    ].map((p) => [p.x, p.y]);
  };

  const polygonPoints = (e) => {
    const pts = [];
    const sides = clamp(parseInt(e.sides, 10) || 6, 3, 16);
    for (let i = 0; i < sides; i += 1) {
      const angle = (i / sides) * TAU - Math.PI / 2 + (e.rotation || 0) * DEG;
      pts.push([e.cx + Math.cos(angle) * e.r, e.cy + Math.sin(angle) * e.r]);
    }
    return pts;
  };

  const ellipsePoints = (e, count = 32) => {
    const pts = [];
    for (let i = 0; i < count; i += 1) {
      const a = (i / count) * TAU;
      const x = e.cx + Math.cos(a) * e.rx;
      const y = e.cy + Math.sin(a) * e.ry;
      const p = rotatePoint(x, y, e.cx, e.cy, e.rotation || 0);
      pts.push([p.x, p.y]);
    }
    return pts;
  };

  const arcGeometry = (e) => {
    if (!Array.isArray(e.points) || e.points.length < 3) return null;
    const [A, B, C] = e.points;
    const ax = A[0], ay = A[1], bx = B[0], by = B[1], cx = C[0], cy = C[1];
    const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(d) < 0.00001) return null;
    const a2 = ax * ax + ay * ay;
    const b2 = bx * bx + by * by;
    const c2 = cx * cx + cy * cy;
    const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
    const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
    const r = Math.hypot(ax - ux, ay - uy);
    const a0 = Math.atan2(ay - uy, ax - ux);
    const a1 = Math.atan2(cy - uy, cx - ux);
    const am = Math.atan2(by - uy, bx - ux);
    const total = normalizeRad(a1 - a0);
    const mid = normalizeRad(am - a0);
    return { cx: ux, cy: uy, r, a0, a1, forward: mid < total };
  };

  const arcSamplePoints = (e, count = 28) => {
    const g = arcGeometry(e);
    if (!g) return e.points?.map((p) => [...p]) || [];
    const pts = [];
    const sweep = g.forward ? normalizeRad(g.a1 - g.a0) : -normalizeRad(g.a0 - g.a1);
    for (let i = 0; i <= count; i += 1) {
      const a = g.a0 + sweep * (i / count);
      pts.push([g.cx + Math.cos(a) * g.r, g.cy + Math.sin(a) * g.r]);
    }
    return pts;
  };

  const measureTextSize = (e) => {
    const lines = String(e.text || '').split('\n');
    const longest = Math.max(...lines.map((line) => line.length), 1);
    const w = longest * e.fontSize * 0.62;
    const h = Math.max(1, lines.length) * e.fontSize * 1.16;
    return { w: Math.max(0.5, w), h };
  };

  const getEntityBounds = (e) => {
    let pts = [];
    if (PATH_TYPES.has(e.type)) pts = e.points || [];
    else if (e.type === 'arc') pts = arcSamplePoints(e);
    else if (e.type === 'rect') pts = rectCorners(e);
    else if (e.type === 'circle') {
      pts = [[e.cx - e.r, e.cy - e.r], [e.cx + e.r, e.cy - e.r], [e.cx + e.r, e.cy + e.r], [e.cx - e.r, e.cy + e.r]];
    } else if (e.type === 'ellipse') pts = ellipsePoints(e);
    else if (e.type === 'polygon') pts = polygonPoints(e);
    else if (e.type === 'measure') pts = e.points || [];
    else if (e.type === 'marker') {
      const r = e.size * 0.6;
      pts = [[e.x - r, e.y - r], [e.x + r, e.y - r], [e.x + r, e.y + r], [e.x - r, e.y + r]];
    } else if (e.type === 'text') {
      const size = measureTextSize(e);
      const corners = [
        [e.x - size.w / 2, e.y - size.h / 2], [e.x + size.w / 2, e.y - size.h / 2],
        [e.x + size.w / 2, e.y + size.h / 2], [e.x - size.w / 2, e.y + size.h / 2]
      ];
      pts = corners.map(([x, y]) => {
        const p = rotatePoint(x, y, e.x, e.y, e.rotation || 0);
        return [p.x, p.y];
      });
      return { x: Math.min(...pts.map((p) => p[0])), y: Math.min(...pts.map((p) => p[1])), w: Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0])), h: Math.max(...pts.map((p) => p[1])) - Math.min(...pts.map((p) => p[1])) };
    }

    if (!pts.length) return { x: 0, y: 0, w: 0, h: 0 };
    const pad = Math.max(0.02, (e.strokeWidth || 0) / 2, e.type === 'wall' ? (e.thickness || 0) / 2 : 0);
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    return {
      x: Math.min(...xs) - pad,
      y: Math.min(...ys) - pad,
      w: Math.max(...xs) - Math.min(...xs) + pad * 2,
      h: Math.max(...ys) - Math.min(...ys) + pad * 2
    };
  };

  const unionBounds = (entities) => {
    if (!entities.length) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    entities.forEach((e) => {
      const b = getEntityBounds(e);
      if (!b) return;
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w);
      maxY = Math.max(maxY, b.y + b.h);
    });
    if (!Number.isFinite(minX)) return null;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  };

  const distanceToSegment = (p, a, b) => {
    const vx = b[0] - a[0];
    const vy = b[1] - a[1];
    const wx = p[0] - a[0];
    const wy = p[1] - a[1];
    const len2 = vx * vx + vy * vy;
    if (len2 === 0) return Math.hypot(wx, wy);
    const t = clamp((wx * vx + wy * vy) / len2, 0, 1);
    return Math.hypot(wx - vx * t, wy - vy * t);
  };

  const pointInPolygon = (p, pts) => {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i][0], yi = pts[i][1];
      const xj = pts[j][0], yj = pts[j][1];
      const intersect = ((yi > p[1]) !== (yj > p[1])) && (p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  };

  const distanceToPoints = (p, pts) => {
    let min = Infinity;
    for (let i = 0; i < pts.length; i += 1) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      min = Math.min(min, distanceToSegment(p, a, b));
    }
    return min;
  };

  const entityCenter = (e) => {
    const b = getEntityBounds(e);
    return b ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : { x: 0, y: 0 };
  };

  const entityFrame = (e) => {
    if (e.type === 'rect') return { cx: e.x + e.w / 2, cy: e.y + e.h / 2, w: e.w, h: e.h, rot: e.rotation || 0 };
    if (e.type === 'circle') return { cx: e.cx, cy: e.cy, w: e.r * 2, h: e.r * 2, rot: 0 };
    if (e.type === 'ellipse') return { cx: e.cx, cy: e.cy, w: e.rx * 2, h: e.ry * 2, rot: e.rotation || 0 };
    if (e.type === 'polygon') return { cx: e.cx, cy: e.cy, w: e.r * 2, h: e.r * 2, rot: e.rotation || 0 };
    if (e.type === 'marker') return { cx: e.x, cy: e.y, w: e.size, h: e.size, rot: e.rotation || 0 };
    if (e.type === 'text') {
      const size = measureTextSize(e);
      return { cx: e.x, cy: e.y, w: size.w, h: size.h, rot: e.rotation || 0 };
    }
    const b = getEntityBounds(e);
    return b ? { cx: b.x + b.w / 2, cy: b.y + b.h / 2, w: b.w, h: b.h, rot: 0 } : null;
  };

  const translateEntity = (e, dx, dy) => {
    if (PATH_TYPES.has(e.type) || e.type === 'arc' || e.type === 'measure') {
      e.points = (e.points || []).map(([x, y]) => [x + dx, y + dy]);
    } else if (e.type === 'rect') {
      e.x += dx; e.y += dy;
    } else if (e.type === 'circle' || e.type === 'ellipse' || e.type === 'polygon') {
      e.cx += dx; e.cy += dy;
    } else if (e.type === 'text' || e.type === 'marker') {
      e.x += dx; e.y += dy;
    }
  };

  const rotateEntityAround = (e, center, deltaDeg) => {
    const a = deltaDeg * DEG;
    const rot = (x, y) => {
      const p = rotatePoint(x, y, center.x, center.y, deltaDeg);
      return [p.x, p.y];
    };
    if (PATH_TYPES.has(e.type) || e.type === 'arc' || e.type === 'measure') {
      e.points = (e.points || []).map((p) => rot(p[0], p[1]));
    } else if (e.type === 'rect') {
      const c = rot(e.x + e.w / 2, e.y + e.h / 2);
      e.x = c[0] - e.w / 2;
      e.y = c[1] - e.h / 2;
    } else if (e.type === 'circle' || e.type === 'ellipse' || e.type === 'polygon') {
      const c = rot(e.cx, e.cy);
      e.cx = c[0]; e.cy = c[1];
    } else if (e.type === 'text' || e.type === 'marker') {
      const c = rot(e.x, e.y);
      e.x = c[0]; e.y = c[1];
    }
    if (e.type !== 'circle') e.rotation = normalizeAngle((e.rotation || 0) + deltaDeg);
  };

  const hitEntity = (e, p, tolerance) => {
    const fill = Boolean(e.filled);
    if (PATH_TYPES.has(e.type)) {
      const pts = e.points || [];
      const width = e.type === 'wall' ? Math.max(tolerance, (e.thickness || 0.3) / 2) : Math.max(tolerance, (e.strokeWidth || 0.1) / 2);
      if (fill && pts.length > 2 && pointInPolygon(p, pts)) return true;
      for (let i = 0; i < pts.length - 1; i += 1) {
        if (distanceToSegment(p, pts[i], pts[i + 1]) <= width) return true;
      }
      if (e.closed && pts.length > 1 && distanceToSegment(p, pts[pts.length - 1], pts[0]) <= width) return true;
      return false;
    }
    if (e.type === 'rect') {
      const inv = rotatePoint(p[0], p[1], e.x + e.w / 2, e.y + e.h / 2, -(e.rotation || 0));
      const inside = inv.x >= e.x && inv.x <= e.x + e.w && inv.y >= e.y && inv.y <= e.y + e.h;
      if (fill && inside) return true;
      if (!inside) {
        const pad = tolerance;
        if (inv.x < e.x - pad || inv.x > e.x + e.w + pad || inv.y < e.y - pad || inv.y > e.y + e.h + pad) return false;
      }
      const d = Math.min(
        Math.abs(inv.x - e.x), Math.abs(inv.x - (e.x + e.w)),
        Math.abs(inv.y - e.y), Math.abs(inv.y - (e.y + e.h))
      );
      return d <= tolerance;
    }
    if (e.type === 'circle') {
      const d = Math.hypot(p[0] - e.cx, p[1] - e.cy);
      return (fill && d <= e.r) || Math.abs(d - e.r) <= tolerance;
    }
    if (e.type === 'ellipse') {
      const inv = rotatePoint(p[0], p[1], e.cx, e.cy, -(e.rotation || 0));
      const nx = (inv.x - e.cx) / Math.max(e.rx, 0.001);
      const ny = (inv.y - e.cy) / Math.max(e.ry, 0.001);
      const v = nx * nx + ny * ny;
      if (fill && v <= 1) return true;
      return Math.abs(Math.sqrt(v) - 1) <= tolerance / Math.max(Math.min(e.rx, e.ry), 0.1);
    }
    if (e.type === 'polygon' || e.type === 'arc') {
      const pts = e.type === 'arc' ? arcSamplePoints(e, 36) : polygonPoints(e);
      if (fill && e.type === 'polygon' && pointInPolygon(p, pts)) return true;
      return pointsDistanceClosed(p, pts) <= tolerance;
    }
    if (e.type === 'marker') return Math.hypot(p[0] - e.x, p[1] - e.y) <= e.size * 0.6 + tolerance;
    if (e.type === 'text') {
      const b = getEntityBounds(e);
      const inv = rotatePoint(p[0], p[1], e.x, e.y, -(e.rotation || 0));
      const size = measureTextSize(e);
      return Math.abs(inv.x - e.x) <= size.w / 2 + tolerance && Math.abs(inv.y - e.y) <= size.h / 2 + tolerance;
    }
    if (e.type === 'measure') {
      return distanceToSegment(p, e.points[0], e.points[1]) <= tolerance * 1.6;
    }
    return false;
  };

  // Fallback hit test for closed outlines. Edge hits always win so a line or
  // wall inside a room can still be picked before the room shell behind it.
  const hitEntityInterior = (e, p) => {
    if (e.type === 'rect') {
      const inv = rotatePoint(p[0], p[1], e.x + e.w / 2, e.y + e.h / 2, -(e.rotation || 0));
      return inv.x >= e.x && inv.x <= e.x + e.w && inv.y >= e.y && inv.y <= e.y + e.h;
    }
    if (e.type === 'circle') {
      return Math.hypot(p[0] - e.cx, p[1] - e.cy) <= e.r;
    }
    if (e.type === 'ellipse') {
      const inv = rotatePoint(p[0], p[1], e.cx, e.cy, -(e.rotation || 0));
      const nx = (inv.x - e.cx) / Math.max(e.rx, 0.001);
      const ny = (inv.y - e.cy) / Math.max(e.ry, 0.001);
      return nx * nx + ny * ny <= 1;
    }
    if (e.type === 'polygon') return pointInPolygon(p, polygonPoints(e));
    if (PATH_TYPES.has(e.type) && e.closed && (e.points || []).length > 2) {
      return pointInPolygon(p, e.points);
    }
    return false;
  };

  const pointsDistanceClosed = (p, pts) => {
    if (!pts.length) return Infinity;
    let min = Infinity;
    for (let i = 0; i < pts.length - 1; i += 1) min = Math.min(min, distanceToSegment(p, pts[i], pts[i + 1]));
    return min;
  };

  // ── Canvas rendering ─────────────────────────────────────────────────────

  const layerById = (id) => state.doc?.layers.find((layer) => layer.id === id);
  const isLayerVisible = (id) => {
    const layer = layerById(id);
    return !layer || layer.visible !== false;
  };
  const isLayerLocked = (id) => {
    const layer = layerById(id);
    return Boolean(layer?.locked);
  };

  const getDrawOrder = () => {
    if (!state.doc) return [];
    const layers = state.doc.layers;
    const visible = layers.filter((layer) => layer.visible !== false).map((layer) => layer.id);
    const result = [];
    visible.forEach((layerId) => {
      state.doc.entities.forEach((e) => {
        if ((e.layer || 'structure') === layerId) result.push(e);
      });
    });
    state.doc.entities.forEach((e) => {
      if (!layers.some((l) => l.id === e.layer)) {
        if (!result.includes(e)) result.push(e);
      }
    });
    return result;
  };

  const setScreenTransform = () => {
    const dpr = state.view.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const setWorldTransform = (camera = state.camera) => {
    const dpr = state.view.dpr;
    ctx.setTransform(dpr * camera.zoom, 0, 0, dpr * camera.zoom, dpr * camera.x, dpr * camera.y);
  };

  const worldToScreen = (x, y) => ({
    x: x * state.camera.zoom + state.camera.x,
    y: y * state.camera.zoom + state.camera.y
  });

  const screenToWorld = (x, y) => ({
    x: (x - state.camera.x) / state.camera.zoom,
    y: (y - state.camera.y) / state.camera.zoom
  });

  const applyDash = (dash, width) => {
    const unit = Math.max(0.08, width || 0.1);
    if (dash === 'dashed') ctx.setLineDash([unit * 6, unit * 4]);
    else if (dash === 'dotted') ctx.setLineDash([unit * 1.2, unit * 3.5]);
    else ctx.setLineDash([]);
  };

  const drawMarkerGlyph = (e) => {
    const color = e.color || MARKERS[e.markerType]?.color || '#7ed8cf';
    const s = e.size;
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate((e.rotation || 0) * DEG);
    ctx.fillStyle = 'rgba(7, 12, 14, 0.76)';
    ctx.strokeStyle = hexToRgba(color, 0.48);
    ctx.lineWidth = Math.max(0.025, s * 0.026);
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.56, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = Math.max(0.045, s * 0.055);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.scale(s * 0.34, s * 0.34);
    ctx.lineWidth = 0.16;
    const type = e.markerType;
    if (type === 'pallet') {
      ctx.beginPath();
      ctx.moveTo(-0.85, -0.72); ctx.lineTo(0.85, -0.72);
      ctx.moveTo(-0.85, 0); ctx.lineTo(0.85, 0);
      ctx.moveTo(-0.85, 0.72); ctx.lineTo(0.85, 0.72);
      ctx.moveTo(-0.55, -0.9); ctx.lineTo(-0.55, 0.9);
      ctx.moveTo(0.55, -0.9); ctx.lineTo(0.55, 0.9);
      ctx.stroke();
    } else if (type === 'vault') {
      ctx.strokeRect(-0.7, -0.9, 1.4, 1.8);
      ctx.beginPath();
      ctx.moveTo(-0.7, 0); ctx.lineTo(0.7, 0);
      ctx.moveTo(0.15, -0.55); ctx.lineTo(0.7, -0.15); ctx.lineTo(0.15, 0.25);
      ctx.stroke();
    } else if (type === 'generator') {
      ctx.strokeRect(-0.8, -0.6, 1.6, 1.2);
      ctx.beginPath();
      ctx.moveTo(-0.35, -0.95); ctx.lineTo(0.35, -0.95);
      ctx.moveTo(0.18, -0.45); ctx.lineTo(-0.28, 0.1); ctx.lineTo(0.1, 0.1); ctx.lineTo(-0.18, 0.65);
      ctx.stroke();
    } else if (type === 'hook') {
      ctx.beginPath();
      ctx.moveTo(-0.25, -0.95); ctx.lineTo(-0.25, 0.25);
      ctx.arc(0.25, 0.25, 0.5, Math.PI, 0, true);
      ctx.lineTo(0.75, 0.52);
      ctx.moveTo(-0.62, -0.95); ctx.lineTo(0.12, -0.95);
      ctx.stroke();
    } else if (type === 'totem') {
      ctx.beginPath();
      ctx.moveTo(0, -0.95); ctx.lineTo(0.82, -0.3); ctx.lineTo(0.58, 0.78); ctx.lineTo(-0.58, 0.78); ctx.lineTo(-0.82, -0.3); ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-0.35, -0.08); ctx.lineTo(-0.08, -0.08);
      ctx.moveTo(0.08, -0.08); ctx.lineTo(0.35, -0.08);
      ctx.moveTo(-0.34, 0.36); ctx.lineTo(0.34, 0.36);
      ctx.stroke();
    } else if (type === 'chest') {
      ctx.strokeRect(-0.9, -0.35, 1.8, 1.15);
      ctx.beginPath();
      ctx.moveTo(-0.9, -0.35); ctx.lineTo(-0.58, -0.9); ctx.lineTo(0.58, -0.9); ctx.lineTo(0.9, -0.35);
      ctx.moveTo(-0.9, 0.25); ctx.lineTo(0.9, 0.25);
      ctx.moveTo(0, 0.15); ctx.lineTo(0, 0.55); ctx.stroke();
    } else if (type === 'hatch') {
      ctx.beginPath();
      ctx.moveTo(0, -0.95); ctx.lineTo(0.95, 0); ctx.lineTo(0, 0.95); ctx.lineTo(-0.95, 0); ctx.closePath();
      ctx.moveTo(0, -0.5); ctx.lineTo(0.5, 0); ctx.lineTo(0, 0.5); ctx.lineTo(-0.5, 0); ctx.closePath();
      ctx.stroke();
    } else if (type === 'gate') {
      ctx.beginPath();
      ctx.moveTo(-0.9, 0.9); ctx.lineTo(-0.9, -0.75); ctx.lineTo(0.9, -0.75); ctx.lineTo(0.9, 0.9);
      ctx.moveTo(-0.9, -0.25); ctx.lineTo(0.9, -0.25);
      ctx.moveTo(-0.42, -0.75); ctx.lineTo(-0.42, 0.9);
      ctx.moveTo(0.42, -0.75); ctx.lineTo(0.42, 0.9);
      ctx.moveTo(-0.9, 0.52); ctx.lineTo(0.9, 0.52);
      ctx.stroke();
    } else if (type === 'basement') {
      ctx.strokeRect(-0.85, -0.85, 1.7, 1.7);
      ctx.strokeRect(-0.45, -0.45, 0.9, 0.9);
      ctx.beginPath();
      ctx.moveTo(-0.85, 0.85); ctx.lineTo(0.85, -0.85);
      ctx.moveTo(-0.85, 0.15); ctx.lineTo(0.15, -0.85);
      ctx.moveTo(-0.15, 0.85); ctx.lineTo(0.85, 0.15);
      ctx.stroke();
    } else if (type === 'stairs') {
      ctx.beginPath();
      ctx.moveTo(-0.9, 0.9); ctx.lineTo(-0.35, 0.9); ctx.lineTo(-0.35, 0.4); ctx.lineTo(0.2, 0.4); ctx.lineTo(0.2, -0.1); ctx.lineTo(0.72, -0.1); ctx.lineTo(0.72, -0.65); ctx.lineTo(0.95, -0.65);
      ctx.moveTo(-0.9, 0.9); ctx.lineTo(-0.9, -0.9);
      ctx.moveTo(-0.62, 0.62); ctx.lineTo(-0.62, -0.45);
      ctx.stroke();
    } else if (type === 'locker') {
      ctx.strokeRect(-0.5, -0.9, 1, 1.8);
      ctx.beginPath();
      ctx.moveTo(-0.5, -0.25); ctx.lineTo(0.5, -0.25);
      ctx.moveTo(-0.5, 0.35); ctx.lineTo(0.5, 0.35);
      ctx.moveTo(-0.12, 0.02); ctx.lineTo(-0.12, 0.02);
      ctx.stroke();
    }
    ctx.restore();
  };

  const drawEntity = (e) => {
    if (!e) return;
    ctx.save();
    ctx.globalAlpha = clamp(e.opacity ?? 1, 0, 1);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'butt';
    const stroke = e.stroke || '#c5b49d';
    const width = Math.max(0, e.strokeWidth || 0);

    if (PATH_TYPES.has(e.type)) {
      const pts = e.points || [];
      if (pts.length < 2 && e.type === 'polyline') { ctx.restore(); return; }
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i][0], pts[i][1]);
      if (e.closed) ctx.closePath();
      if (e.type === 'wall') {
        const thickness = Math.max(0.06, e.thickness || width || 0.3);
        ctx.lineCap = 'square';
        applyDash(e.dash, thickness);
        ctx.strokeStyle = '#263336';
        ctx.lineWidth = thickness + 0.1;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = stroke;
        ctx.lineWidth = thickness;
        ctx.stroke();
      } else {
        applyDash(e.dash, width);
        if (e.filled && pts.length >= 3) {
          ctx.fillStyle = e.fill || '#887760';
          ctx.fill();
        }
        if (width > 0) {
          ctx.strokeStyle = stroke;
          ctx.lineWidth = width;
          ctx.stroke();
        }
      }
    } else if (e.type === 'rect') {
      const cx = e.x + e.w / 2;
      const cy = e.y + e.h / 2;
      ctx.translate(cx, cy);
      ctx.rotate((e.rotation || 0) * DEG);
      if (e.filled) {
        ctx.fillStyle = e.fill || '#887760';
        ctx.fillRect(-e.w / 2, -e.h / 2, e.w, e.h);
      }
      if (width > 0) {
        applyDash(e.dash, width);
        ctx.strokeStyle = stroke;
        ctx.lineWidth = width;
        ctx.strokeRect(-e.w / 2, -e.h / 2, e.w, e.h);
      }
    } else if (e.type === 'circle') {
      ctx.beginPath();
      ctx.arc(e.cx, e.cy, e.r, 0, TAU);
      if (e.filled) {
        ctx.fillStyle = e.fill || '#887760';
        ctx.fill();
      }
      if (width > 0) {
        applyDash(e.dash, width);
        ctx.strokeStyle = stroke;
        ctx.lineWidth = width;
        ctx.stroke();
      }
    } else if (e.type === 'ellipse') {
      ctx.translate(e.cx, e.cy);
      ctx.rotate((e.rotation || 0) * DEG);
      ctx.beginPath();
      ctx.ellipse(0, 0, Math.max(0.01, e.rx), Math.max(0.01, e.ry), 0, 0, TAU);
      if (e.filled) {
        ctx.fillStyle = e.fill || '#887760';
        ctx.fill();
      }
      if (width > 0) {
        applyDash(e.dash, width);
        ctx.strokeStyle = stroke;
        ctx.lineWidth = width;
        ctx.stroke();
      }
    } else if (e.type === 'polygon') {
      const pts = polygonPoints(e);
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
      if (e.filled) {
        ctx.fillStyle = e.fill || '#887760';
        ctx.fill();
      }
      if (width > 0) {
        applyDash(e.dash, width);
        ctx.strokeStyle = stroke;
        ctx.lineWidth = width;
        ctx.stroke();
      }
    } else if (e.type === 'arc') {
      const g = arcGeometry(e);
      if (g) {
        ctx.beginPath();
        ctx.arc(g.cx, g.cy, g.r, g.a0, g.a1, !g.forward);
        if (width > 0) {
          applyDash(e.dash, width);
          ctx.strokeStyle = stroke;
          ctx.lineWidth = width;
          ctx.stroke();
        }
      } else {
        const pts = e.points || [];
        if (pts.length > 1) {
          ctx.beginPath();
          ctx.moveTo(pts[0][0], pts[0][1]);
          for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i][0], pts[i][1]);
          ctx.strokeStyle = stroke;
          ctx.lineWidth = width;
          ctx.stroke();
        }
      }
    } else if (e.type === 'text') {
      ctx.translate(e.x, e.y);
      ctx.rotate((e.rotation || 0) * DEG);
      ctx.fillStyle = e.color || '#b9b3a6';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const family = '"Bahnschrift SemiCondensed", "Arial Narrow", "Segoe UI", sans-serif';
      ctx.font = `600 ${e.fontSize}px ${family}`;
      if ('letterSpacing' in ctx) ctx.letterSpacing = `${e.fontSize * 0.055}px`;
      const lines = String(e.text || '').split('\n');
      const lineHeight = e.fontSize * 1.12;
      const start = -(lines.length - 1) * lineHeight / 2;
      lines.forEach((line, index) => ctx.fillText(line, 0, start + index * lineHeight));
    } else if (e.type === 'marker') {
      drawMarkerGlyph(e);
    } else if (e.type === 'measure') {
      const [a, b] = e.points || [];
      if (a && b) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = Math.max(0.035, width);
        ctx.setLineDash([0.28, 0.22]);
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.stroke();
        ctx.setLineDash([]);
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const nx = -(b[1] - a[1]) / (len || 1);
        const ny = (b[0] - a[0]) / (len || 1);
        const tick = 0.28;
        ctx.beginPath();
        ctx.moveTo(a[0] - nx * tick, a[1] - ny * tick); ctx.lineTo(a[0] + nx * tick, a[1] + ny * tick);
        ctx.moveTo(b[0] - nx * tick, b[1] - ny * tick); ctx.lineTo(b[0] + nx * tick, b[1] + ny * tick);
        ctx.stroke();
        const mx = (a[0] + b[0]) / 2 + nx * 0.55;
        const my = (a[1] + b[1]) / 2 + ny * 0.55;
        const label = `${formatNum(len, 2)} m`;
        ctx.font = '600 0.52px "Bahnschrift SemiCondensed", "Arial Narrow", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = 'rgba(7, 12, 14, 0.82)';
        ctx.fillRect(mx - tw / 2 - 0.16, my - 0.35, tw + 0.32, 0.7);
        ctx.fillStyle = stroke;
        ctx.fillText(label, mx, my);
      }
    }
    ctx.restore();
  };

  const drawGrid = () => {
    if (!state.doc.showGrid) return;
    const { w, h } = state.view;
    const zoom = state.camera.zoom;
    let spacing = state.doc.gridSize || 1;
    while (spacing * zoom < 8) spacing *= 5;
    while (spacing * zoom > 54) spacing /= 2;
    const major = spacing * 5;
    const left = -state.camera.x / zoom;
    const top = -state.camera.y / zoom;
    const right = (w - state.camera.x) / zoom;
    const bottom = (h - state.camera.y) / zoom;
    setScreenTransform();
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(111, 160, 156, 0.055)';
    ctx.beginPath();
    const x0 = Math.floor(left / spacing) * spacing;
    for (let x = x0; x <= right; x += spacing) {
      if (Math.abs(x / major - Math.round(x / major)) < 0.001) continue;
      const sx = Math.round(x * zoom + state.camera.x) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, h);
    }
    const y0 = Math.floor(top / spacing) * spacing;
    for (let y = y0; y <= bottom; y += spacing) {
      if (Math.abs(y / major - Math.round(y / major)) < 0.001) continue;
      const sy = Math.round(y * zoom + state.camera.y) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(w, sy);
    }
    ctx.stroke();

    ctx.strokeStyle = 'rgba(118, 171, 166, 0.105)';
    ctx.beginPath();
    const mx0 = Math.floor(left / major) * major;
    for (let x = mx0; x <= right; x += major) {
      const sx = Math.round(x * zoom + state.camera.x) + 0.5;
      ctx.moveTo(sx, 0); ctx.lineTo(sx, h);
    }
    const my0 = Math.floor(top / major) * major;
    for (let y = my0; y <= bottom; y += major) {
      const sy = Math.round(y * zoom + state.camera.y) + 0.5;
      ctx.moveTo(0, sy); ctx.lineTo(w, sy);
    }
    ctx.stroke();

    if (left < 0 && right > 0) {
      const sx = Math.round(state.camera.x) + 0.5;
      ctx.strokeStyle = 'rgba(205, 118, 71, 0.18)';
      ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, h); ctx.stroke();
    }
    if (top < 0 && bottom > 0) {
      const sy = Math.round(state.camera.y) + 0.5;
      ctx.strokeStyle = 'rgba(205, 118, 71, 0.18)';
      ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(w, sy); ctx.stroke();
    }
  };

  const drawUnderlay = () => {
    const image = state.doc.image;
    if (!image || image.visible === false) return;
    if (underlaySrc !== image.dataUrl) {
      underlaySrc = image.dataUrl;
      underlayImage = new Image();
      underlayImage.onload = () => scheduleDraw();
      underlayImage.src = image.dataUrl;
    }
    if (!underlayImage || !underlayImage.complete) return;
    setWorldTransform();
    ctx.save();
    ctx.globalAlpha = image.opacity ?? 0.42;
    ctx.drawImage(underlayImage, image.x, image.y, image.w, image.h);
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = 'rgba(126, 216, 207, 0.22)';
    ctx.lineWidth = 0.04;
    ctx.setLineDash([0.4, 0.3]);
    ctx.strokeRect(image.x, image.y, image.w, image.h);
    ctx.restore();
  };

  const handlePositions = (frame) => {
    const local = [
      ['nw', -0.5, -0.5], ['n', 0, -0.5], ['ne', 0.5, -0.5],
      ['e', 0.5, 0], ['se', 0.5, 0.5], ['s', 0, 0.5],
      ['sw', -0.5, 0.5], ['w', -0.5, 0]
    ];
    return local.map(([key, lx, ly]) => {
      const p = rotatePoint(frame.cx + lx * frame.w, frame.cy + ly * frame.h, frame.cx, frame.cy, frame.rot);
      return { key, x: p.x, y: p.y };
    });
  };

  const drawSelection = () => {
    state.handleAreas = [];
    const selected = state.doc.entities.filter((e) => state.selection.has(e.id) && isLayerVisible(e.layer));
    if (!selected.length) return;
    const bounds = unionBounds(selected);
    if (!bounds) return;
    const single = selected.length === 1 ? selected[0] : null;
    const isShape = single && (SHAPE_TYPES.has(single.type) || single.type === 'text' || single.type === 'marker');
    const frame = single && isShape ? entityFrame(single) : {
      cx: bounds.x + bounds.w / 2, cy: bounds.y + bounds.h / 2, w: bounds.w, h: bounds.h, rot: 0
    };
    const topLeft = worldToScreen(bounds.x, bounds.y);
    const bottomRight = worldToScreen(bounds.x + bounds.w, bounds.y + bounds.h);

    setScreenTransform();
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(126, 216, 207, 0.55)';
    if (!isShape) {
      ctx.strokeRect(topLeft.x - 0.5, topLeft.y - 0.5, bottomRight.x - topLeft.x + 1, bottomRight.y - topLeft.y + 1);
    }
    ctx.restore();

    if (frame) {
      const corners = handlePositions(frame).map((h) => worldToScreen(h.x, h.y));
      ctx.save();
      ctx.strokeStyle = 'rgba(126, 216, 207, 0.72)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      [2, 4, 6].forEach((i) => ctx.lineTo(corners[i].x, corners[i].y));
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
      handlePositions(frame).forEach((h) => {
        const p = worldToScreen(h.x, h.y);
        drawHandle(p.x, p.y);
        state.handleAreas.push({ kind: 'scale', key: h.key, x: p.x, y: p.y, r: 7 });
      });
    }

    if (single && (PATH_TYPES.has(single.type) || single.type === 'arc' || single.type === 'measure')) {
      const pts = single.type === 'arc' || single.type === 'measure' ? single.points : single.points;
      pts.forEach((pt, index) => {
        const p = worldToScreen(pt[0], pt[1]);
        drawNodeHandle(p.x, p.y);
        state.handleAreas.push({ kind: 'node', index, x: p.x, y: p.y, r: 8 });
      });
    }

    // Rotation handle.
    let top;
    if (isShape && frame) {
      const c = rotatePoint(frame.cx, frame.cy - frame.h / 2, frame.cx, frame.cy, frame.rot);
      const p = worldToScreen(c.x, c.y);
      const centerScreen = worldToScreen(frame.cx, frame.cy);
      const dx = p.x - centerScreen.x;
      const dy = p.y - centerScreen.y;
      const len = Math.hypot(dx, dy) || 1;
      top = { x: p.x + (dx / len) * 25, y: p.y + (dy / len) * 25, base: p };
    } else {
      top = { x: (topLeft.x + bottomRight.x) / 2, y: topLeft.y - 25, base: { x: (topLeft.x + bottomRight.x) / 2, y: topLeft.y } };
    }
    setScreenTransform();
    ctx.save();
    ctx.strokeStyle = 'rgba(126, 216, 207, 0.42)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(top.base.x, top.base.y);
    ctx.lineTo(top.x, top.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(top.x, top.y, 5.5, 0, TAU);
    ctx.fillStyle = '#0b1315';
    ctx.fill();
    ctx.strokeStyle = 'rgba(126, 216, 207, 0.9)';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(top.x, top.y, 2.6, 0.4, 5.6);
    ctx.strokeStyle = 'rgba(126, 216, 207, 0.72)';
    ctx.stroke();
    ctx.restore();
    state.handleAreas.push({ kind: 'rotate', x: top.x, y: top.y, r: 9 });

    if (selected.length > 1) {
      const tag = `${selected.length} OBJECTS`;
      drawBadge((topLeft.x + bottomRight.x) / 2, bottomRight.y + 14, tag);
    }
  };

  const drawHandle = (x, y) => {
    setScreenTransform();
    ctx.save();
    ctx.fillStyle = '#0b1416';
    ctx.strokeStyle = 'rgba(126, 216, 207, 0.95)';
    ctx.lineWidth = 1.2;
    ctx.fillRect(x - 3.5, y - 3.5, 7, 7);
    ctx.strokeRect(x - 3.5, y - 3.5, 7, 7);
    ctx.restore();
  };

  const drawNodeHandle = (x, y) => {
    setScreenTransform();
    ctx.save();
    ctx.fillStyle = '#102022';
    ctx.strokeStyle = 'rgba(126, 216, 207, 0.9)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(x, y, 3.8, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  };

  const drawBadge = (x, y, text) => {
    setScreenTransform();
    ctx.save();
    ctx.font = '600 8px "Cascadia Mono", Consolas, monospace';
    const w = ctx.measureText(text).width + 12;
    ctx.fillStyle = 'rgba(8, 14, 16, 0.9)';
    ctx.strokeStyle = 'rgba(126, 216, 207, 0.32)';
    ctx.lineWidth = 1;
    ctx.fillRect(x - w / 2, y - 8, w, 16);
    ctx.strokeRect(x - w / 2 + 0.5, y - 7.5, w - 1, 15);
    ctx.fillStyle = '#7ed8cf';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
    ctx.restore();
  };

  const makePreviewStyle = (e) => {
    e.stroke = '#e3a06f';
    e.strokeWidth = Math.max(0.08, e.strokeWidth || 0.1);
    e.color = '#e3a06f';
    e.fill = '#e3a06f';
    e.opacity = 0.92;
    if (e.type === 'marker') e.color = '#e3a06f';
  };

  const drawDraft = () => {
    const d = state.draft;
    const tool = state.tool;
    setWorldTransform();

    if (tool === 'marker' && state.pointerScreen && !state.pan) {
      const ghost = {
        type: 'marker', x: state.snap?.point?.x ?? state.pointerWorld.x, y: state.snap?.point?.y ?? state.pointerWorld.y,
        markerType: state.activeMarker, size: state.settings.markerSize, rotation: 0,
        color: MARKERS[state.activeMarker]?.color, opacity: 0.55
      };
      drawEntity(ghost);
    }

    if (!d) return;
    if (d.tool === 'line' || d.tool === 'polyline' || d.tool === 'wall') {
      const pts = [...d.points];
      if (d.current) pts.push([d.current.x, d.current.y]);
      if (pts.length > 1) {
        const e = {
          type: d.tool === 'wall' ? 'wall' : 'polyline',
          points: pts, closed: false,
          thickness: state.settings.wallThickness,
          stroke: '#e3a06f', strokeWidth: d.tool === 'wall' ? state.settings.wallThickness : state.settings.lineWeight,
          fill: '#e3a06f', filled: false, opacity: 0.92, dash: 'solid'
        };
        drawEntity(e);
      }
      setScreenTransform();
      d.points.forEach((p) => {
        const s = worldToScreen(p[0], p[1]);
        drawNodeHandle(s.x, s.y);
      });
      if (d.current) {
        const s = worldToScreen(d.current.x, d.current.y);
        drawNodeHandle(s.x, s.y);
        const length = pts.length > 1 ? Math.hypot(d.current.x - pts[pts.length - 2][0], d.current.y - pts[pts.length - 2][1]) : 0;
        if (length > 0) drawDimensionLabel(s.x + 16, s.y - 16, `${formatNum(length, 2)} m`);
      }
    } else if (d.tool === 'rect' || d.tool === 'ellipse' || d.tool === 'circle' || d.tool === 'polygon') {
      const e = draftShapeEntity();
      if (e) {
        makePreviewStyle(e);
        drawEntity(e);
      }
      if (d.current) {
        const s = worldToScreen(d.current.x, d.current.y);
        drawDimensionLabel(s.x + 16, s.y - 16, draftDimensionText());
      }
    } else if (d.tool === 'arc') {
      const pts = [...d.points];
      if (d.current && pts.length < 3) pts.push([d.current.x, d.current.y]);
      setWorldTransform();
      if (pts.length === 3) {
        const e = { type: 'arc', points: pts, stroke: '#e3a06f', strokeWidth: 0.1, opacity: 0.92, dash: 'solid' };
        drawEntity(e);
      } else if (pts.length > 1) {
        ctx.save();
        ctx.strokeStyle = '#e3a06f';
        ctx.lineWidth = 0.08;
        ctx.setLineDash([0.3, 0.22]);
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.stroke();
        ctx.restore();
      }
      setScreenTransform();
      pts.forEach((p) => { const s = worldToScreen(p[0], p[1]); drawNodeHandle(s.x, s.y); });
    } else if (d.tool === 'measure') {
      const e = {
        type: 'measure', points: [[d.start.x, d.start.y], [d.current?.x ?? d.start.x, d.current?.y ?? d.start.y]],
        stroke: '#7ed8cf', strokeWidth: 0.06, opacity: 0.9
      };
      setWorldTransform();
      drawEntity(e);
    }
  };

  const draftShapeEntity = () => {
    const d = state.draft;
    if (!d || !d.current || !d.start) return null;
    if (d.tool === 'rect') {
      let w = d.current.x - d.start.x;
      let h = d.current.y - d.start.y;
      if (d.shift) {
        const size = Math.max(Math.abs(w), Math.abs(h));
        w = Math.sign(w || 1) * size;
        h = Math.sign(h || 1) * size;
      }
      return {
        type: 'rect', x: Math.min(d.start.x, d.start.x + w), y: Math.min(d.start.y, d.start.y + h),
        w: Math.abs(w), h: Math.abs(h), rotation: 0,
        stroke: '#e3a06f', strokeWidth: state.settings.lineWeight, fill: '#e3a06f', filled: false, opacity: 0.92, dash: 'dashed'
      };
    }
    if (d.tool === 'ellipse') {
      let w = d.current.x - d.start.x;
      let h = d.current.y - d.start.y;
      if (d.shift) {
        const size = Math.max(Math.abs(w), Math.abs(h));
        w = Math.sign(w || 1) * size;
        h = Math.sign(h || 1) * size;
      }
      return {
        type: 'ellipse', cx: d.start.x + w / 2, cy: d.start.y + h / 2,
        rx: Math.abs(w) / 2, ry: Math.abs(h) / 2, rotation: 0,
        stroke: '#e3a06f', strokeWidth: state.settings.lineWeight, fill: '#e3a06f', filled: false, opacity: 0.92, dash: 'dashed'
      };
    }
    if (d.tool === 'circle') {
      const r = Math.hypot(d.current.x - d.start.x, d.current.y - d.start.y);
      return {
        type: 'circle', cx: d.start.x, cy: d.start.y, r, rotation: 0,
        stroke: '#e3a06f', strokeWidth: state.settings.lineWeight, fill: '#e3a06f', filled: false, opacity: 0.92, dash: 'dashed'
      };
    }
    if (d.tool === 'polygon') {
      const r = Math.hypot(d.current.x - d.start.x, d.current.y - d.start.y);
      const rotation = Math.atan2(d.current.y - d.start.y, d.current.x - d.start.x) / DEG + 90;
      return {
        type: 'polygon', cx: d.start.x, cy: d.start.y, r, sides: state.settings.polygonSides,
        rotation, stroke: '#e3a06f', strokeWidth: state.settings.lineWeight, fill: '#e3a06f', filled: false, opacity: 0.92, dash: 'dashed'
      };
    }
    return null;
  };

  const draftDimensionText = () => {
    const d = state.draft;
    if (!d?.start || !d?.current) return '';
    if (d.tool === 'rect') {
      let w = Math.abs(d.current.x - d.start.x);
      let h = Math.abs(d.current.y - d.start.y);
      if (d.shift) w = h = Math.max(w, h);
      return `${formatNum(w, 2)} × ${formatNum(h, 2)} m`;
    }
    if (d.tool === 'ellipse') {
      let w = Math.abs(d.current.x - d.start.x);
      let h = Math.abs(d.current.y - d.start.y);
      if (d.shift) w = h = Math.max(w, h);
      return `${formatNum(w, 2)} × ${formatNum(h, 2)} m`;
    }
    if (d.tool === 'circle') return `R ${formatNum(Math.hypot(d.current.x - d.start.x, d.current.y - d.start.y), 2)} m`;
    if (d.tool === 'polygon') return `${state.settings.polygonSides} SIDES · R ${formatNum(Math.hypot(d.current.x - d.start.x, d.current.y - d.start.y), 2)} m`;
    return '';
  };

  const drawDimensionLabel = (x, y, text) => {
    if (!text) return;
    setScreenTransform();
    ctx.save();
    ctx.font = '600 8px "Cascadia Mono", Consolas, monospace';
    const w = ctx.measureText(text).width + 14;
    ctx.fillStyle = 'rgba(8, 14, 16, 0.9)';
    ctx.strokeStyle = 'rgba(205, 118, 71, 0.52)';
    ctx.lineWidth = 1;
    ctx.fillRect(x, y - 9, w, 18);
    ctx.strokeRect(x + 0.5, y - 8.5, w - 1, 17);
    ctx.fillStyle = '#e3a06f';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 7, y + 0.5);
    ctx.restore();
  };

  const drawSnap = () => {
    if (!state.snap || !state.snap.point) return;
    const p = worldToScreen(state.snap.point.x, state.snap.point.y);
    setScreenTransform();
    ctx.save();
    const label = state.snap.kind || 'SNAP';
    ctx.strokeStyle = 'rgba(126, 216, 207, 0.85)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5, 0, TAU);
    ctx.moveTo(p.x - 9, p.y); ctx.lineTo(p.x - 4, p.y);
    ctx.moveTo(p.x + 4, p.y); ctx.lineTo(p.x + 9, p.y);
    ctx.moveTo(p.x, p.y - 9); ctx.lineTo(p.x, p.y - 4);
    ctx.moveTo(p.x, p.y + 4); ctx.lineTo(p.x, p.y + 9);
    ctx.stroke();
    ctx.font = '600 7px "Cascadia Mono", Consolas, monospace';
    const w = ctx.measureText(label).width + 10;
    ctx.fillStyle = 'rgba(8, 14, 16, 0.9)';
    ctx.fillRect(p.x + 10, p.y + 9, w, 14);
    ctx.fillStyle = '#7ed8cf';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, p.x + 15, p.y + 16);
    ctx.restore();
  };

  const drawHover = () => {
    if (state.tool !== 'select' || state.drag || state.marquee) return;
    const e = state.hoverEntity;
    if (!e || state.selection.has(e.id)) return;
    const b = getEntityBounds(e);
    const a = worldToScreen(b.x, b.y);
    const c = worldToScreen(b.x + b.w, b.y + b.h);
    setScreenTransform();
    ctx.save();
    ctx.setLineDash([3, 4]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(126, 216, 207, 0.3)';
    ctx.strokeRect(a.x, a.y, c.x - a.x, c.y - a.y);
    ctx.restore();
  };

  const drawMarquee = () => {
    if (!state.marquee) return;
    const m = state.marquee;
    const a = worldToScreen(Math.min(m.x0, m.x1), Math.min(m.y0, m.y1));
    const b = worldToScreen(Math.max(m.x0, m.x1), Math.max(m.y0, m.y1));
    setScreenTransform();
    ctx.save();
    ctx.fillStyle = 'rgba(126, 216, 207, 0.045)';
    ctx.strokeStyle = 'rgba(126, 216, 207, 0.55)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
    ctx.strokeRect(a.x + 0.5, a.y + 0.5, b.x - a.x, b.y - a.y);
    ctx.restore();
  };

  const drawBackground = () => {
    const { w, h } = state.view;
    setScreenTransform();
    const gradient = ctx.createRadialGradient(w * 0.52, h * 0.4, 0, w * 0.52, h * 0.4, Math.max(w, h) * 0.8);
    gradient.addColorStop(0, '#0d1517');
    gradient.addColorStop(0.55, '#090f11');
    gradient.addColorStop(1, '#060a0b');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = '#132023';
    ctx.lineWidth = 1;
    const step = 64;
    for (let x = 0; x < w; x += step) {
      ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, h); ctx.stroke();
    }
    ctx.restore();
  };

  const draw = () => {
    state.frameRequested = false;
    if (!state.doc || !state.view.w) return;
    const dpr = state.view.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, state.view.w, state.view.h);
    drawBackground();
    drawUnderlay();
    drawGrid();
    setWorldTransform();
    getDrawOrder().forEach(drawEntity);
    drawDraft();
    drawHover();
    drawSelection();
    drawSnap();
    drawMarquee();
    setScreenTransform();
  };

  const scheduleDraw = () => {
    if (state.frameRequested) return;
    state.frameRequested = true;
    requestAnimationFrame(draw);
  };

  // ── UI: top bar, library, tool panel ────────────────────────────────────

  const selectedEntities = () => state.doc.entities.filter((e) => state.selection.has(e.id));
  const getVisibleEntities = () => state.doc.entities.filter((e) => isLayerVisible(e.layer));

  const updateTopbar = () => {
    if (!state.doc) return;
    $('#docTitle').textContent = state.doc.name;
    $('#realmLabel').textContent = state.doc.realm.toUpperCase();
    $('#realmMeta').textContent = state.doc.realm.split(' ')[0].toUpperCase();
    document.title = `${state.doc.name} — Fogforge`;
  };

  const updateSaveState = (dirty) => {
    const wrap = $('#saveState');
    const label = $('#saveLabel');
    if (dirty) {
      wrap.classList.add('is-dirty');
      label.textContent = 'UNSAVED CHANGES';
    } else {
      wrap.classList.remove('is-dirty');
      label.textContent = 'SAVED LOCALLY';
    }
  };

  const updateHistoryButtons = () => {
    $('#undoBtn').disabled = history.undo.length === 0;
    $('#redoBtn').disabled = history.redo.length === 0;
  };

  const updateStatus = () => {
    const selected = selectedEntities();
    const count = state.doc.entities.length;
    $('#selectionStatus').textContent = selected.length
      ? `${selected.length} SELECTED`
      : `${count} OBJECT${count === 1 ? '' : 'S'}`;
    const snapping = [];
    if (state.doc.snapGrid) snapping.push('GRID');
    if (state.doc.snapGeom) snapping.push('POINTS');
    if (state.doc.ortho) snapping.push('ORTHO');
    $('#snapStatus').textContent = snapping.length ? `SNAP: ${snapping.join(' + ')}` : 'SNAP: OFF';
    $('#modeLabel').textContent = `${TOOLS[state.tool]?.name.toUpperCase() || 'SELECT'} MODE`;
    const zoomPct = Math.round((state.camera.zoom / BASE_ZOOM) * 100);
    $('#zoomLabel').textContent = `${zoomPct}%`;
    $('#zoomFitBtn').textContent = `${zoomPct}%`;
    $('#statusGridBtn').classList.toggle('is-on', state.doc.showGrid);
    $('#statusSnapBtn').classList.toggle('is-on', state.doc.snapGrid || state.doc.snapGeom);
    $('#gridSnapBtn').classList.toggle('is-on', state.doc.snapGrid);
    $('#geomSnapBtn').classList.toggle('is-on', state.doc.snapGeom);
    $('#orthoBtn').classList.toggle('is-on', state.doc.ortho);
  };

  const updateMode = () => {
    const meta = TOOLS[state.tool] || TOOLS.select;
    $('#toolName').textContent = meta.name;
    $('#toolDesc').textContent = meta.desc;
    $('#toolShortcut').textContent = meta.shortcut;
    $('#toolIcon use').setAttribute('href', `#${meta.icon}`);
    $$('.tool-btn[data-tool]').forEach((button) => {
      button.classList.toggle('active', button.dataset.tool === state.tool);
    });
    canvas.classList.toggle('is-drawing', !['select', 'pan'].includes(state.tool));
    canvas.classList.toggle('is-pan-tool', state.tool === 'pan');
    renderToolOptions();
    updatePrompt();
    updateStatus();
    scheduleDraw();
  };

  const updatePrompt = () => {
    const tool = state.tool;
    const d = state.draft;
    let text = 'Click an object to inspect it. Drag to marquee-select.';
    let key = TOOLS[tool]?.shortcut || 'V';
    if (tool === 'pan') text = 'Drag anywhere to pan the sheet. Scroll to zoom at the cursor.';
    if (tool === 'select') text = state.selection.size ? 'Drag to move. Use handles to scale or rotate. Alt-click selects inside a group.' : 'Click an object to inspect it. Drag to marquee-select.';
    if (tool === 'line') text = d ? 'Click next point · ENTER / right-click to finish · click start to close.' : 'Click to start a line chain · SHIFT constrains to ortho.';
    if (tool === 'polyline') text = d ? 'Click next point · click the first node to close · ENTER to finish.' : 'Click to start a connected path · ENTER finishes.';
    if (tool === 'wall') text = d ? 'Click next wall point · click first node to close · ENTER to finish.' : 'Click to start a wall run · thickness is set at left.';
    if (tool === 'rect') text = d ? 'Click opposite corner · SHIFT makes a square · ESC cancels.' : 'Click first corner of the rectangle.';
    if (tool === 'circle') text = d ? 'Click to set radius · ESC cancels.' : 'Click the centre of the circle.';
    if (tool === 'ellipse') text = d ? 'Click opposite bounding corner · SHIFT constrains · ESC cancels.' : 'Click first corner of the ellipse bounds.';
    if (tool === 'polygon') text = d ? 'Click to set radius and rotation · ESC cancels.' : `Click the polygon centre · ${state.settings.polygonSides} sides.`;
    if (tool === 'arc') {
      const n = d?.points.length || 0;
      text = n === 0 ? 'Click the arc start point.' : n === 1 ? 'Click a point along the curve.' : 'Click the arc end point.';
    }
    if (tool === 'text') text = 'Click the map where the label should sit.';
    if (tool === 'marker') text = `Click to stamp ${MARKERS[state.activeMarker]?.name || 'marker'} · choose another prop in the library.`;
    if (tool === 'measure') text = d ? 'Click the end point · SHIFT constrains.' : 'Click the first dimension point.';
    const prompt = $('#canvasPrompt');
    prompt.classList.toggle('is-active', Boolean(d) || !['select', 'pan'].includes(tool));
    if (text !== state.lastPrompt) {
      $('#promptText').textContent = text;
      $('.prompt-key', prompt).textContent = key;
      state.lastPrompt = text;
    }
  };

  const toolNumber = (label, setting, value, unit = 'm', step = 0.02, min = 0.01) => `
    <div class="tool-option-row">
      <label>${label}</label>
      <span class="inline-number"><input type="number" data-tool-setting="${setting}" value="${formatNum(value, 2)}" step="${step}" min="${min}"><em>${unit}</em></span>
    </div>`;

  const renderToolOptions = () => {
    const wrap = $('#toolOptions');
    const tool = state.tool;
    const keep = `
      <div class="switch-row" data-tool-toggle="keepActive">
        <span>Keep tool active</span>
        <button class="switch ${state.settings.keepActive ? 'on' : ''}" aria-label="Keep tool active"></button>
      </div>`;
    if (tool === 'select') {
      wrap.innerHTML = `
        <div class="tiny-note">Drag inside an object to move it. Corner handles scale; the circular handle rotates. Shift-click adds to the selection.</div>`;
    } else if (tool === 'pan') {
      wrap.innerHTML = `<div class="tiny-note">Hold Space or middle-drag with any tool. Scroll to zoom around the cursor. Press F to fit the sheet.</div>`;
    } else if (tool === 'wall') {
      wrap.innerHTML = toolNumber('Wall thickness', 'wallThickness', state.settings.wallThickness) + keep;
    } else if (tool === 'polygon') {
      wrap.innerHTML = `
        <div class="tool-option-row">
          <label>Sides</label>
          <span class="inline-number"><input type="number" data-tool-setting="polygonSides" value="${state.settings.polygonSides}" step="1" min="3" max="16"><em>#</em></span>
        </div>
        ${toolNumber('Line weight', 'lineWeight', state.settings.lineWeight)}${keep}`;
    } else if (tool === 'text') {
      wrap.innerHTML = toolNumber('Label size', 'fontSize', state.settings.fontSize) + keep;
    } else if (tool === 'marker') {
      const meta = MARKERS[state.activeMarker];
      wrap.innerHTML = `
        <div class="tool-option-row">
          <label>Active prop</label>
          <span class="tag-chip accent"><svg style="width:11px;height:11px;margin-right:4px"><use href="#${meta.icon}"></use></svg>${meta.name.toUpperCase()}</span>
        </div>
        ${toolNumber('Marker size', 'markerSize', state.settings.markerSize)}${keep}`;
    } else if (tool === 'measure') {
      wrap.innerHTML = `<div class="tiny-note">Measurements are editable annotations. Shift constrains the dimension to horizontal or vertical.</div>`;
    } else if (['line', 'polyline', 'rect', 'circle', 'ellipse', 'arc'].includes(tool)) {
      wrap.innerHTML = toolNumber('Line weight', 'lineWeight', state.settings.lineWeight) + keep;
    } else {
      wrap.innerHTML = '';
    }
  };

  const presetSVG = (preset) => {
    const bounds = unionBounds(preset.objects) || { x: -2, y: -2, w: 4, h: 4 };
    const pad = Math.max(1.2, Math.max(bounds.w, bounds.h) * 0.05);
    const vb = `${formatNum(bounds.x - pad, 2)} ${formatNum(bounds.y - pad, 2)} ${formatNum(bounds.w + pad * 2, 2)} ${formatNum(bounds.h + pad * 2, 2)}`;
    let body = '';
    preset.objects.forEach((e) => {
      if (e.type === 'rect') {
        const cx = e.x + e.w / 2;
        const cy = e.y + e.h / 2;
        const transform = e.rotation ? ` transform="rotate(${formatNum(e.rotation, 2)} ${formatNum(cx, 2)} ${formatNum(cy, 2)})"` : '';
        const fill = e.filled ? ` fill="${e.fill}" fill-opacity="${formatNum(Math.min(0.32, (e.opacity || 1) * 0.8), 2)}"` : ' fill="none"';
        body += `<rect x="${formatNum(e.x, 2)}" y="${formatNum(e.y, 2)}" width="${formatNum(e.w, 2)}" height="${formatNum(e.h, 2)}"${transform}${fill} stroke-opacity="${formatNum(e.opacity || 1, 2)}" stroke-width="${formatNum(Math.max(0.18, e.strokeWidth || 0), 2)}"/>`;
      } else if (e.type === 'wall') {
        const pts = e.points.map((p) => p.join(',')).join(' ');
        body += `<polyline points="${pts}" fill="none" stroke-width="${formatNum(Math.max(0.34, e.thickness || 0.3), 2)}" stroke-opacity="${formatNum(e.opacity ?? 1, 2)}"/>`;
      } else if (e.type === 'polyline') {
        const pts = e.points.map((p) => p.join(',')).join(' ');
        const tag = e.closed ? 'polygon' : 'polyline';
        body += `<${tag} points="${pts}" fill="${e.filled ? e.fill : 'none'}" fill-opacity=".24" stroke-width="${formatNum(Math.max(0.18, e.strokeWidth || 0.1), 2)}" stroke-opacity="${formatNum(e.opacity ?? 1, 2)}"/>`;
      } else if (e.type === 'circle') {
        body += `<circle cx="${formatNum(e.cx, 2)}" cy="${formatNum(e.cy, 2)}" r="${formatNum(e.r, 2)}" fill="${e.filled ? e.fill : 'none'}" fill-opacity=".2" stroke-width="${formatNum(Math.max(0.14, e.strokeWidth || 0.1), 2)}" stroke-opacity="${formatNum(e.opacity ?? 1, 2)}"/>`;
      } else if (e.type === 'ellipse') {
        body += `<ellipse cx="${formatNum(e.cx, 2)}" cy="${formatNum(e.cy, 2)}" rx="${formatNum(e.rx, 2)}" ry="${formatNum(e.ry, 2)}" transform="rotate(${formatNum(e.rotation || 0, 2)} ${formatNum(e.cx, 2)} ${formatNum(e.cy, 2)})" fill="${e.filled ? e.fill : 'none'}" stroke-width="${formatNum(Math.max(0.14, e.strokeWidth || 0.1), 2)}"/>`;
      } else if (e.type === 'polygon') {
        const pts = polygonPoints(e).map((p) => p.join(',')).join(' ');
        body += `<polygon points="${pts}" fill="${e.filled ? e.fill : 'none'}" stroke-width="${formatNum(Math.max(0.14, e.strokeWidth || 0.1), 2)}"/>`;
      } else if (e.type === 'arc') {
        const g = arcGeometry(e);
        if (g) {
          const start = [g.cx + Math.cos(g.a0) * g.r, g.cy + Math.sin(g.a0) * g.r];
          const end = [g.cx + Math.cos(g.a1) * g.r, g.cy + Math.sin(g.a1) * g.r];
          const sweep = g.forward ? normalizeRad(g.a1 - g.a0) : normalizeRad(g.a0 - g.a1);
          body += `<path d="M ${formatNum(start[0], 2)} ${formatNum(start[1], 2)} A ${formatNum(g.r, 2)} ${formatNum(g.r, 2)} 0 ${sweep > Math.PI ? 1 : 0} ${g.forward ? 1 : 0} ${formatNum(end[0], 2)} ${formatNum(end[1], 2)}" fill="none" stroke-width="${formatNum(Math.max(0.16, e.strokeWidth || 0.08), 2)}" stroke-opacity="${formatNum(e.opacity ?? 1, 2)}"/>`;
        }
      } else if (e.type === 'marker') {
        body += `<circle cx="${formatNum(e.x, 2)}" cy="${formatNum(e.y, 2)}" r="${formatNum((e.size || 1.8) * 0.38, 2)}" fill="${MARKERS[e.markerType]?.color || '#c78a5c'}" fill-opacity=".9" stroke="none"/>`;
      } else if (e.type === 'text') {
        body += `<text x="${formatNum(e.x, 2)}" y="${formatNum(e.y, 2)}" text-anchor="middle" fill="#a89d8c" fill-opacity=".28" font-size="${formatNum(e.fontSize || 0.7, 2)}" font-family="Arial Narrow, sans-serif" letter-spacing=".08">${escapeHTML(e.text)}</text>`;
      } else if (e.type === 'measure') {
        const [a, b] = e.points;
        body += `<line x1="${formatNum(a[0], 2)}" y1="${formatNum(a[1], 2)}" x2="${formatNum(b[0], 2)}" y2="${formatNum(b[1], 2)}" stroke-width=".16" stroke-dasharray=".6 .4" opacity=".4"/>`;
      }
    });
    return `<svg viewBox="${vb}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${body}</svg>`;
  };

  const renderPresets = (filter = 'all') => {
    const grid = $('#presetGrid');
    grid.innerHTML = PRESETS.filter((p) => filter === 'all' || p.category === filter).map((preset) => `
      <button class="preset-card" data-preset="${preset.id}" title="${escapeHTML(preset.description)}">
        <span class="preset-thumb">${presetSVG(preset)}</span>
        <span class="preset-card-body">
          <span>
            <span class="preset-card-name">${escapeHTML(preset.name)}</span>
            <span class="preset-card-tag">${escapeHTML(preset.tag)}</span>
          </span>
          <span class="preset-card-size">${escapeHTML(preset.sizeLabel)}</span>
        </span>
      </button>
    `).join('');
  };

  const renderProps = () => {
    const grid = $('#propGrid');
    grid.innerHTML = Object.entries(MARKERS).map(([key, marker]) => `
      <button class="prop-card ${state.activeMarker === key ? 'active' : ''}" data-marker="${key}" title="${marker.name}">
        <svg><use href="#${marker.icon}"></use></svg>
        <span>${marker.name}</span>
      </button>
    `).join('');
    const meta = MARKERS[state.activeMarker];
    $('#propDetail').innerHTML = `
      <span class="prop-detail-icon"><svg><use href="#${meta.icon}"></use></svg></span>
      <div><strong>${meta.name}</strong><p>Click the map to place. Hold Shift while placing to preserve the current rotation.</p></div>`;
  };

  const renderLayers = () => {
    const list = $('#layerList');
    list.innerHTML = state.doc.layers.map((layer) => {
      const count = state.doc.entities.filter((e) => (e.layer || 'structure') === layer.id).length;
      return `
        <div class="layer-row ${state.activeLayer === layer.id ? 'active' : ''} ${layer.visible === false ? 'hidden-layer' : ''}" data-layer-row="${layer.id}">
          <button class="layer-main" data-layer-select="${layer.id}">
            <span class="layer-color" style="background:${layer.color};color:${layer.color}"></span>
            <span class="layer-label"><span class="layer-name">${escapeHTML(layer.name)}</span><span class="layer-count">${count} OBJECT${count === 1 ? '' : 'S'}</span></span>
          </button>
          <span class="layer-actions">
            <button class="layer-icon ${layer.visible === false ? 'is-off' : 'is-on'}" data-layer-toggle="${layer.id}" title="${layer.visible === false ? 'Show' : 'Hide'} layer"><svg><use href="#${layer.visible === false ? 'i-eye-off' : 'i-eye'}"></use></svg></button>
            <button class="layer-icon ${layer.locked ? 'is-on' : ''}" data-layer-lock="${layer.id}" title="${layer.locked ? 'Unlock' : 'Lock'} layer"><svg><use href="#${layer.locked ? 'i-lock' : 'i-unlock'}"></use></svg></button>
          </span>
        </div>`;
    }).join('');
  };

  const toast = (title, message = '', type = 'info', duration = 3000) => {
    const stack = $('#toastStack');
    const item = document.createElement('div');
    item.className = `toast ${type}`;
    item.innerHTML = `<div><strong>${escapeHTML(title)}</strong>${message ? `<span>${escapeHTML(message)}</span>` : ''}</div>`;
    stack.appendChild(item);
    setTimeout(() => {
      item.classList.add('out');
      setTimeout(() => item.remove(), 240);
    }, duration);
  };

  // ── UI: inspector ───────────────────────────────────────────────────────

  const field = (label, prop, value, opts = {}) => `
    <label class="field ${opts.full ? 'full' : ''}">
      <span>${label}${opts.unit ? `<em>${opts.unit}</em>` : ''}</span>
      <input type="${opts.type || 'number'}" data-prop="${prop}" value="${escapeHTML(value)}"
        ${opts.step ? `step="${opts.step}"` : ''} ${opts.min !== undefined ? `min="${opts.min}"` : ''} ${opts.max !== undefined ? `max="${opts.max}"` : ''}>
    </label>`;

  const colorField = (label, prop, value) => `
    <label class="field">
      <span>${label}</span>
      <span class="color-field">
        <input type="color" data-prop="${prop}" value="${/^#[0-9a-f]{6}$/i.test(value) ? value : '#b9b3a6'}">
        <input type="text" data-prop="${prop}Hex" value="${escapeHTML(value)}" maxlength="9" spellcheck="false">
      </span>
    </label>`;

  const switchRow = (label, action, on) => `
    <div class="switch-row">
      <span>${label}</span>
      <button class="switch ${on ? 'on' : ''}" data-action="${action}" aria-pressed="${on ? 'true' : 'false'}"></button>
    </div>`;

  const selectionBanner = (icon, kicker, name) => `
    <div class="type-banner">
      <span class="type-icon"><svg><use href="#${icon}"></use></svg></span>
      <div><small>${kicker}</small><strong>${escapeHTML(name)}</strong></div>
    </div>`;

  const inspectorMap = () => {
    const entities = state.doc.entities;
    const bounds = unionBounds(entities);
    const area = bounds ? (bounds.w * bounds.h) : 0;
    const visibleLayers = state.doc.layers.filter((l) => l.visible !== false).length;
    const image = state.doc.image;
    return `
      <section class="inspector-section">
        <div class="section-title"><span>DOCUMENT</span><span>MAP 01</span></div>
        <div class="prop-grid-form map-name-input">
          <label class="field full"><span>MAP NAME</span><input type="text" data-map-name value="${escapeHTML(state.doc.name)}" maxlength="80"></label>
          <label class="field full"><span>REALM</span><select data-map-realm>${REALMS.map((realm) => `<option value="${escapeHTML(realm)}" ${state.doc.realm === realm ? 'selected' : ''}>${escapeHTML(realm)}</option>`).join('')}</select></label>
        </div>
        <div class="stat-strip" style="margin-top:10px">
          <div class="stat-cell"><b>${entities.length}</b><span>Objects</span></div>
          <div class="stat-cell"><b>${visibleLayers}/${state.doc.layers.length}</b><span>Layers</span></div>
          <div class="stat-cell"><b>${area ? `${formatNum(Math.round(area))}m²` : '—'}</b><span>Extent</span></div>
        </div>
      </section>
      <section class="inspector-section">
        <div class="section-title"><span>GRID & SNAPPING</span><span>DRAFTING</span></div>
        <div class="prop-grid-form" style="margin-bottom:9px">
          <label class="field full"><span>GRID SIZE</span><select data-map-grid>
            ${[0.25, 0.5, 1, 2, 5].map((size) => `<option value="${size}" ${state.doc.gridSize === size ? 'selected' : ''}>${size} m</option>`).join('')}
          </select></label>
        </div>
        ${switchRow('Show drawing grid', 'toggle-show-grid', state.doc.showGrid)}
        ${switchRow('Snap to grid', 'toggle-snap-grid', state.doc.snapGrid)}
        ${switchRow('Snap to points & edges', 'toggle-snap-geom', state.doc.snapGeom)}
        ${switchRow('Always constrain ortho', 'toggle-ortho', state.doc.ortho)}
      </section>
      <section class="inspector-section">
        <div class="section-title"><span>REFERENCE UNDERLAY</span><span>IMAGE</span></div>
        ${image ? `
          <div class="underlay-box">
            <span class="underlay-preview"><img src="${image.dataUrl}" alt=""></span>
            <div class="underlay-meta">
              <strong>${escapeHTML(image.name)}</strong>
              <span>${formatNum(image.w, 1)} × ${formatNum(image.h, 1)} m</span>
              <div class="underlay-actions"><button data-action="fit-underlay">FIT</button><button data-action="remove-underlay">REMOVE</button></div>
            </div>
          </div>
          <label class="field" style="margin-top:9px"><span>OPACITY<em>%</em></span><span class="range-row"><input type="range" min="5" max="100" value="${Math.round((image.opacity || 0.42) * 100)}" data-underlay-opacity><span class="range-value">${Math.round((image.opacity || 0.42) * 100)}%</span></span></label>
        ` : `
          <button class="btn" data-action="import-underlay" style="width:100%"><svg><use href="#i-image"></use></svg>IMPORT REFERENCE IMAGE</button>
          <div class="empty-inspector-note">Drop in a screenshot or site plan to trace over. Images stay in your browser and are included in local saves.</div>
        `}
      </section>
      <section class="inspector-section">
        <div class="section-title"><span>SHEET ACTIONS</span><span>OUTPUT</span></div>
        <div class="action-grid">
          <button class="btn" data-action="fit-view"><svg><use href="#i-fit"></use></svg>FIT VIEW</button>
          <button class="btn" data-action="download-json"><svg><use href="#i-save"></use></svg>SAVE COPY</button>
          <button class="btn" data-action="export-png"><svg><use href="#i-export"></use></svg>PNG SHEET</button>
          <button class="btn danger" data-action="clear-map"><svg><use href="#i-trash"></use></svg>CLEAR MAP</button>
        </div>
      </section>`;
  };

  const geometryFields = (e) => {
    if (e.type === 'rect') {
      return field('X', 'x', formatNum(e.x)) + field('Y', 'y', formatNum(e.y)) +
        field('Width', 'w', formatNum(e.w), { unit: 'm' }) + field('Height', 'h', formatNum(e.h), { unit: 'm' }) +
        field('Rotation', 'rotation', formatNum(e.rotation || 0), { unit: '°' }) + `<div class="field"><span>AREA<em>m²</em></span><input type="text" value="${formatNum(Math.abs(e.w * e.h), 1)}" disabled></div>`;
    }
    if (e.type === 'circle') {
      return field('Centre X', 'cx', formatNum(e.cx)) + field('Centre Y', 'cy', formatNum(e.cy)) +
        field('Radius', 'r', formatNum(e.r), { unit: 'm' }) +
        `<div class="field"><span>DIAMETER<em>m</em></span><input type="text" value="${formatNum(e.r * 2)}" disabled></div>` +
        `<div class="field"><span>AREA<em>m²</em></span><input type="text" value="${formatNum(Math.PI * e.r * e.r, 1)}" disabled></div>`;
    }
    if (e.type === 'ellipse') {
      return field('Centre X', 'cx', formatNum(e.cx)) + field('Centre Y', 'cy', formatNum(e.cy)) +
        field('Radius X', 'rx', formatNum(e.rx), { unit: 'm' }) + field('Radius Y', 'ry', formatNum(e.ry), { unit: 'm' }) +
        field('Rotation', 'rotation', formatNum(e.rotation || 0), { unit: '°' }) +
        `<div class="field"><span>AREA<em>m²</em></span><input type="text" value="${formatNum(Math.PI * e.rx * e.ry, 1)}" disabled></div>`;
    }
    if (e.type === 'polygon') {
      return field('Centre X', 'cx', formatNum(e.cx)) + field('Centre Y', 'cy', formatNum(e.cy)) +
        field('Radius', 'r', formatNum(e.r), { unit: 'm' }) + field('Sides', 'sides', e.sides, { step: 1, min: 3, max: 16 }) +
        field('Rotation', 'rotation', formatNum(e.rotation || 0), { unit: '°' }) +
        `<div class="field"><span>AREA<em>m²</em></span><input type="text" value="${formatNum(0.5 * e.sides * e.r * e.r * Math.sin(TAU / e.sides), 1)}" disabled></div>`;
    }
    if (e.type === 'text') {
      return `<label class="field full"><span>TEXT</span><textarea data-prop="text" rows="3">${escapeHTML(e.text)}</textarea></label>` +
        field('Position X', 'x', formatNum(e.x)) + field('Position Y', 'y', formatNum(e.y)) +
        field('Size', 'fontSize', formatNum(e.fontSize), { unit: 'm', step: 0.05 }) +
        field('Rotation', 'rotation', formatNum(e.rotation || 0), { unit: '°' });
    }
    if (e.type === 'marker') {
      return `<label class="field full"><span>MARKER TYPE</span><select data-prop="markerType">${Object.entries(MARKERS).map(([key, marker]) => `<option value="${key}" ${e.markerType === key ? 'selected' : ''}>${marker.name}</option>`).join('')}</select></label>` +
        field('Position X', 'x', formatNum(e.x)) + field('Position Y', 'y', formatNum(e.y)) +
        field('Size', 'size', formatNum(e.size), { unit: 'm', step: 0.05 }) +
        field('Rotation', 'rotation', formatNum(e.rotation || 0), { unit: '°' });
    }
    if (e.type === 'arc') {
      const g = arcGeometry(e);
      return field('Centre X', 'gcx', g ? formatNum(g.cx) : '—', { type: 'text' }) + field('Centre Y', 'gcy', g ? formatNum(g.cy) : '—', { type: 'text' }) +
        `<div class="field"><span>RADIUS<em>m</em></span><input type="text" value="${g ? formatNum(g.r) : '—'}" disabled></div>` +
        `<div class="field"><span>NODES</span><input type="text" value="3-point" disabled></div>`;
    }
    if (e.type === 'measure') {
      const len = e.points?.length > 1 ? Math.hypot(e.points[1][0] - e.points[0][0], e.points[1][1] - e.points[0][1]) : 0;
      return `<div class="field full"><span>DISTANCE<em>m</em></span><input type="text" value="${formatNum(len)}" disabled></div>`;
    }
    const b = getEntityBounds(e);
    const len = e.points?.reduce((sum, p, i, arr) => i ? sum + Math.hypot(p[0] - arr[i - 1][0], p[1] - arr[i - 1][1]) : 0, 0) || 0;
    return field('Bounds X', 'bx', formatNum(b.x)) + field('Bounds Y', 'by', formatNum(b.y)) +
      `<div class="field"><span>LENGTH<em>m</em></span><input type="text" value="${formatNum(len)}" disabled></div>` +
      `<div class="field"><span>NODES</span><input type="text" value="${e.points?.length || 0}" disabled></div>` +
      (e.type === 'wall' ? field('Thickness', 'thickness', formatNum(e.thickness), { unit: 'm' }) : '') +
      (e.type === 'polyline' ? switchRow('Closed path', 'toggle-closed', e.closed) : '');
  };

  const appearanceFields = (e) => {
    if (e.type === 'text') {
      return colorField('Colour', 'color', e.color || '#b9b3a6') +
        `<label class="field"><span>OPACITY<em>%</em></span><span class="range-row"><input type="range" min="5" max="100" value="${Math.round((e.opacity ?? 1) * 100)}" data-prop="opacityRange"><span class="range-value">${Math.round((e.opacity ?? 1) * 100)}%</span></span></label>`;
    }
    if (e.type === 'marker') {
      return colorField('Marker colour', 'color', e.color || MARKERS[e.markerType]?.color || '#7ed8cf') +
        `<label class="field"><span>OPACITY<em>%</em></span><span class="range-row"><input type="range" min="5" max="100" value="${Math.round((e.opacity ?? 1) * 100)}" data-prop="opacityRange"><span class="range-value">${Math.round((e.opacity ?? 1) * 100)}%</span></span></label>`;
    }
    if (e.type === 'measure') {
      return colorField('Dimension colour', 'stroke', e.stroke || '#7ed8cf') +
        `<label class="field"><span>OPACITY<em>%</em></span><span class="range-row"><input type="range" min="5" max="100" value="${Math.round((e.opacity ?? 1) * 100)}" data-prop="opacityRange"><span class="range-value">${Math.round((e.opacity ?? 1) * 100)}%</span></span></label>`;
    }
    let html = colorField('Stroke colour', 'stroke', e.stroke || '#c5b49d');
    if (e.type !== 'wall') html += field('Line weight', 'strokeWidth', formatNum(e.strokeWidth || 0.1), { unit: 'm', step: 0.01 });
    if (e.type === 'wall') html += field('Wall thickness', 'thickness', formatNum(e.thickness || 0.3), { unit: 'm', step: 0.01 });
    html += `<div class="field full"><span>FILL</span>${switchRow('Filled shape', 'toggle-filled', e.filled)}</div>`;
    if (e.filled) html += colorField('Fill colour', 'fill', e.fill || '#887760');
    html += `<label class="field full"><span>LINE STYLE</span><select data-prop="dash">${['solid', 'dashed', 'dotted'].map((dash) => `<option value="${dash}" ${e.dash === dash ? 'selected' : ''}>${dash.toUpperCase()}</option>`).join('')}</select></label>`;
    html += `<label class="field full"><span>OPACITY<em>%</em></span><span class="range-row"><input type="range" min="5" max="100" value="${Math.round((e.opacity ?? 1) * 100)}" data-prop="opacityRange"><span class="range-value">${Math.round((e.opacity ?? 1) * 100)}%</span></span></label>`;
    return html;
  };

  const inspectorSingle = (e) => {
    const type = TYPE_LABEL[e.type] || 'Object';
    const isGroup = Boolean(e.groupId);
    const displayName = e.name || type;
    return `
      ${selectionBanner(TYPE_ICON[e.type] || 'i-cursor', type.toUpperCase(), displayName)}
      ${isGroup ? `<div class="group-chip"><svg><use href="#i-group"></use></svg><span>GROUP · ${escapeHTML(e.groupName || 'Selection group')}</span><button data-action="ungroup" style="margin-left:auto">UNGROUP</button></div>` : ''}
      <section class="inspector-section">
        <div class="section-title"><span>IDENTITY</span><span>${e.id.slice(-5).toUpperCase()}</span></div>
        <div class="prop-grid-form">
          <label class="field full"><span>NAME</span><input type="text" data-prop="name" value="${escapeHTML(displayName)}" maxlength="80"></label>
          <label class="field full"><span>LAYER</span><select data-prop="layer">${state.doc.layers.map((layer) => `<option value="${layer.id}" ${e.layer === layer.id ? 'selected' : ''}>${escapeHTML(layer.name)}${layer.visible === false ? ' · hidden' : ''}${layer.locked ? ' · locked' : ''}</option>`).join('')}</select></label>
        </div>
      </section>
      <section class="inspector-section">
        <div class="section-title"><span>GEOMETRY</span><span>METRES</span></div>
        <div class="prop-grid-form">${geometryFields(e)}</div>
      </section>
      <section class="inspector-section">
        <div class="section-title"><span>APPEARANCE</span><span>STYLE</span></div>
        <div class="prop-grid-form">${appearanceFields(e)}</div>
      </section>
      <section class="inspector-section">
        <div class="section-title"><span>ARRANGE</span><span>OBJECT</span></div>
        <div class="action-grid">
          <button class="btn" data-action="duplicate"><svg><use href="#i-copy"></use></svg>DUPLICATE</button>
          <button class="btn" data-action="bring-front"><svg><use href="#i-layers"></use></svg>TO FRONT</button>
          <button class="btn" data-action="flip-h"><svg><use href="#i-flip-h"></use></svg>FLIP H</button>
          <button class="btn" data-action="flip-v"><svg><use href="#i-flip-v"></use></svg>FLIP V</button>
          ${isGroup ? '<button class="btn" data-action="ungroup"><svg><use href="#i-ungroup"></use></svg>UNGROUP</button>' : '<button class="btn" data-action="group" disabled><svg><use href="#i-group"></use></svg>GROUP</button>'}
          <button class="btn danger" data-action="delete"><svg><use href="#i-trash"></use></svg>DELETE</button>
        </div>
      </section>`;
  };

  const inspectorMulti = (selected) => {
    const b = unionBounds(selected);
    const groups = new Set(selected.map((e) => e.groupId).filter(Boolean));
    const sameGroup = groups.size === 1 && selected.every((e) => e.groupId === [...groups][0]);
    return `
      ${selectionBanner('i-layers', 'MULTI-SELECTION', `${selected.length} objects`)}
      ${sameGroup ? `<div class="group-chip"><svg><use href="#i-group"></use></svg><span>GROUP · ${escapeHTML(selected[0].groupName || 'Selection group')}</span><button data-action="ungroup" style="margin-left:auto">UNGROUP</button></div>` : ''}
      <section class="inspector-section">
        <div class="section-title"><span>SELECTION</span><span>${selected.length} ITEMS</span></div>
        <div class="info-list">
          <div class="info-row"><span>Bounds width</span><b>${formatNum(b?.w || 0)} m</b></div>
          <div class="info-row"><span>Bounds height</span><b>${formatNum(b?.h || 0)} m</b></div>
          <div class="info-row"><span>Groups</span><b>${groups.size || '—'}</b></div>
          <div class="info-row"><span>Layers</span><b>${new Set(selected.map((e) => e.layer)).size}</b></div>
        </div>
      </section>
      <section class="inspector-section">
        <div class="section-title"><span>ALIGN</span><span>EDGES</span></div>
        <div class="align-row">
          <button class="align-btn" data-action="align-left" title="Align left"><svg><use href="#i-align-left"></use></svg></button>
          <button class="align-btn" data-action="align-center-h" title="Align centre"><svg><use href="#i-align-center"></use></svg></button>
          <button class="align-btn" data-action="align-right" title="Align right"><svg><use href="#i-align-right"></use></svg></button>
          <button class="align-btn" data-action="align-top" title="Align top"><svg><use href="#i-align-top"></use></svg></button>
          <button class="align-btn" data-action="align-center-v" title="Align middle"><svg><use href="#i-align-middle"></use></svg></button>
          <button class="align-btn" data-action="align-bottom" title="Align bottom"><svg><use href="#i-align-bottom"></use></svg></button>
        </div>
        <div class="action-grid" style="margin-top:8px">
          <button class="btn" data-action="duplicate"><svg><use href="#i-copy"></use></svg>DUPLICATE</button>
          <button class="btn" data-action="group"><svg><use href="#i-group"></use></svg>GROUP</button>
          <button class="btn" data-action="flip-h"><svg><use href="#i-flip-h"></use></svg>FLIP H</button>
          <button class="btn" data-action="flip-v"><svg><use href="#i-flip-v"></use></svg>FLIP V</button>
          <button class="btn danger" data-action="delete" style="grid-column: 1 / -1"><svg><use href="#i-trash"></use></svg>DELETE SELECTION</button>
        </div>
      </section>
      <section class="inspector-section">
        <div class="section-title"><span>CONTENTS</span><span>FIRST 6</span></div>
        <div class="selection-list">
          ${selected.slice(0, 6).map((e) => `<div class="selection-item"><span></span>${escapeHTML(e.name || TYPE_LABEL[e.type])}<em>${(TYPE_LABEL[e.type] || e.type).toUpperCase()}</em></div>`).join('')}
          ${selected.length > 6 ? `<div class="selection-item" style="justify-content:center;color:#465654">+ ${selected.length - 6} MORE</div>` : ''}
        </div>
      </section>`;
  };

  const updateInspector = () => {
    const selected = selectedEntities();
    const title = $('#inspectorTitle');
    const badge = $('#inspectorBadge');
    const body = $('#inspectorBody');
    if (!selected.length) {
      title.textContent = 'Map settings';
      badge.textContent = 'SHEET';
      body.innerHTML = inspectorMap();
    } else if (selected.length === 1) {
      title.textContent = selected[0].name || TYPE_LABEL[selected[0].type] || 'Object';
      badge.textContent = (TYPE_LABEL[selected[0].type] || 'OBJECT').toUpperCase().slice(0, 12);
      body.innerHTML = inspectorSingle(selected[0]);
    } else {
      title.textContent = 'Multiple objects';
      badge.textContent = `${selected.length} SELECTED`;
      body.innerHTML = inspectorMulti(selected);
    }
  };

  const updateUI = () => {
    updateTopbar();
    updateMode();
    renderLayers();
    updateInspector();
    updateHistoryButtons();
    updateStatus();
    $('#emptyState').classList.toggle('is-hidden', state.doc.entities.length > 0);
    scheduleDraw();
  };

  // ── History & persistence ───────────────────────────────────────────────

  const serializeDoc = () => JSON.stringify(state.doc);

  const initHistory = () => {
    history.undo = [];
    history.redo = [];
    history.last = serializeDoc();
    updateHistoryButtons();
  };

  const schedulePersist = () => {
    updateSaveState(true);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => persistNow(), 420);
  };

  const persistNow = () => {
    if (!state.doc) return;
    try {
      localStorage.setItem(STORAGE_KEY, serializeDoc());
      updateSaveState(false);
    } catch (error) {
      updateSaveState(true);
      if (!state.storageWarned) {
        state.storageWarned = true;
        toast('Local storage is full', 'Your map is still open. Export a JSON copy to avoid losing it.', 'warn', 5000);
      }
    }
  };

  const commit = (label = 'Edit') => {
    if (!state.doc) return false;
    const before = JSON.stringify(state.doc);
    if (before === history.last) {
      scheduleDraw();
      return false;
    }
    state.doc.updatedAt = Date.now();
    const after = JSON.stringify(state.doc);
    history.undo.push(history.last);
    if (history.undo.length > history.limit) history.undo.shift();
    history.redo = [];
    history.last = after;
    schedulePersist();
    updateHistoryButtons();
    updateStatus();
    scheduleDraw();
    return true;
  };

  const afterRestore = () => {
    state.selection.clear();
    state.hoverEntity = null;
    state.draft = null;
    state.drag = null;
    state.marquee = null;
    state.snap = null;
    underlayImage = null;
    underlaySrc = '';
    updateTopbar();
    updateMode();
    renderLayers();
    updateInspector();
    updateHistoryButtons();
    updateStatus();
    $('#emptyState').classList.toggle('is-hidden', state.doc.entities.length > 0);
    scheduleDraw();
    schedulePersist();
  };

  const undo = () => {
    if (!history.undo.length) return;
    history.redo.push(history.last);
    const previous = history.undo.pop();
    history.last = previous;
    state.doc = normalizeDoc(JSON.parse(previous));
    afterRestore();
    toast('Undo', 'Previous map state restored.');
  };

  const redo = () => {
    if (!history.redo.length) return;
    history.undo.push(history.last);
    const next = history.redo.pop();
    history.last = next;
    state.doc = normalizeDoc(JSON.parse(next));
    afterRestore();
    toast('Redo', 'Change reapplied.');
  };

  const saveCopy = () => {
    const payload = {
      app: 'Fogforge',
      format: 'dbd-trial-map',
      version: 1,
      exportedAt: new Date().toISOString(),
      document: state.doc
    };
    downloadText(JSON.stringify(payload, null, 2), `${slugify(state.doc.name)}.dbdmap.json`, 'application/json');
    persistNow();
    toast('Map copy saved', `${slugify(state.doc.name)}.dbdmap.json`);
  };

  const newMap = () => {
    if (state.doc.entities.length && !window.confirm('Start a new blank trial ground? Your current autosaved map will be replaced.')) return;
    state.doc = createBlankDoc('Untitled Trial Grounds', state.doc.realm);
    state.selection.clear();
    state.draft = null;
    state.activeLayer = 'structure';
    underlayImage = null;
    underlaySrc = '';
    initHistory();
    schedulePersist();
    updateUI();
    fitToContent();
    toast('New trial ground', 'Blank sheet ready. Draw a plan or insert a preset.');
  };

  const importMap = (file) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        const raw = parsed.document || parsed;
        if (!raw || !Array.isArray(raw.entities)) throw new Error('Missing entity list');
        state.doc = normalizeDoc(raw);
        state.selection.clear();
        state.draft = null;
        underlayImage = null;
        underlaySrc = '';
        initHistory();
        schedulePersist();
        updateUI();
        fitToContent();
        toast('Map imported', `${state.doc.entities.length} objects loaded.`);
      } catch (error) {
        toast('Import failed', 'That file is not a valid Fogforge .dbdmap.json.', 'error', 4300);
      }
    };
    reader.readAsText(file);
  };

  // ── Viewport ─────────────────────────────────────────────────────────────

  const isPhoneLayout = () => window.matchMedia('(max-width: 900px)').matches;

  const resizeCanvas = () => {
    const rect = stage.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const prevW = state.view.w;
    const prevH = state.view.h;
    const center = prevW > 2 && prevH > 2 ? screenToWorld(prevW / 2, prevH / 2) : null;
    state.view.w = Math.max(1, rect.width);
    state.view.h = Math.max(1, rect.height);
    state.view.dpr = dpr;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    if (center) {
      state.camera.x = state.view.w / 2 - center.x * state.camera.zoom;
      state.camera.y = state.view.h / 2 - center.y * state.camera.zoom;
    }
    scheduleDraw();
  };

  const fitToContent = () => {
    if (!state.doc) return;
    const { w, h } = state.view;
    if (!w || !h) return;
    const phone = isPhoneLayout();
    const bounds = unionBounds(getVisibleEntities());
    const target = bounds || { x: 0, y: 0, w: 44, h: 32 };
    const pad = 2.5;
    const availableW = Math.max(120, w - (phone ? 48 : 110));
    const availableH = Math.max(120, h - (phone ? 196 : 170));
    const zoom = clamp(Math.min(availableW / (target.w + pad * 2), availableH / (target.h + pad * 2)), 2, 48);
    state.camera.zoom = zoom;
    const cx = target.x + target.w / 2;
    const cy = target.y + target.h / 2;
    state.camera.x = w / 2 - cx * zoom;
    state.camera.y = (h - (phone ? 104 : 56)) / 2 - cy * zoom;
    updateStatus();
    scheduleDraw();
  };

  const zoomAt = (factor, screenX, screenY) => {
    const before = screenToWorld(screenX, screenY);
    const zoom = clamp(state.camera.zoom * factor, 2, 80);
    state.camera.zoom = zoom;
    state.camera.x = screenX - before.x * zoom;
    state.camera.y = screenY - before.y * zoom;
    updateStatus();
    scheduleDraw();
  };

  const zoomBy = (factor) => {
    zoomAt(factor, state.view.w / 2, state.view.h / 2);
  };

  // ── Selection ────────────────────────────────────────────────────────────

  const entityGroupIds = (entity, ignoreGroup = false) => {
    if (!entity) return [];
    if (ignoreGroup || !entity.groupId) return [entity.id];
    return state.doc.entities.filter((e) => e.groupId === entity.groupId).map((e) => e.id);
  };

  const setSelection = (ids, refresh = true) => {
    state.selection = new Set(ids.filter((id) => state.doc.entities.some((e) => e.id === id)));
    if (refresh) {
      updateInspector();
      updateStatus();
      scheduleDraw();
    }
  };

  const toggleSelectionGroup = (ids) => {
    const allSelected = ids.every((id) => state.selection.has(id));
    ids.forEach((id) => {
      if (allSelected) state.selection.delete(id);
      else state.selection.add(id);
    });
    updateInspector();
    updateStatus();
    scheduleDraw();
  };

  const selectAll = () => {
    const visible = getDrawOrder().filter((e) => !isLayerLocked(e.layer)).map((e) => e.id);
    setSelection(visible);
  };

  // ── Snapping ─────────────────────────────────────────────────────────────

  const collectSnapCandidates = () => {
    const candidates = [];
    const segments = [];
    getDrawOrder().forEach((e) => {
      if (isLayerLocked(e.layer)) return;
      const add = (x, y, kind, priority = 8) => candidates.push({ x, y, kind, priority });
      if (PATH_TYPES.has(e.type)) {
        const pts = e.points || [];
        pts.forEach((p) => add(p[0], p[1], 'ENDPOINT', 10));
        for (let i = 0; i < pts.length - 1; i += 1) {
          const a = pts[i], b = pts[i + 1];
          add((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 'MIDPOINT', 7);
          segments.push([a, b]);
        }
        if (e.closed && pts.length > 1) {
          add((pts[0][0] + pts[pts.length - 1][0]) / 2, (pts[0][1] + pts[pts.length - 1][1]) / 2, 'MIDPOINT', 7);
          segments.push([pts[pts.length - 1], pts[0]]);
        }
      } else if (e.type === 'rect') {
        const pts = rectCorners(e);
        pts.forEach((p) => add(p[0], p[1], 'CORNER', 10));
        for (let i = 0; i < 4; i += 1) {
          const a = pts[i], b = pts[(i + 1) % 4];
          add((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 'MIDPOINT', 7);
          segments.push([a, b]);
        }
        add(e.x + e.w / 2, e.y + e.h / 2, 'CENTRE', 8);
      } else if (e.type === 'circle') {
        add(e.cx, e.cy, 'CENTRE', 8);
        [[e.cx - e.r, e.cy], [e.cx + e.r, e.cy], [e.cx, e.cy - e.r], [e.cx, e.cy + e.r]].forEach((p) => add(p[0], p[1], 'QUADRANT', 9));
      } else if (e.type === 'ellipse') {
        add(e.cx, e.cy, 'CENTRE', 8);
        ellipsePoints(e, 16).forEach((p) => add(p[0], p[1], 'QUADRANT', 6));
      } else if (e.type === 'polygon') {
        add(e.cx, e.cy, 'CENTRE', 8);
        const pts = polygonPoints(e);
        pts.forEach((p) => add(p[0], p[1], 'CORNER', 10));
        for (let i = 0; i < pts.length; i += 1) {
          const a = pts[i], b = pts[(i + 1) % pts.length];
          add((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 'MIDPOINT', 6);
          segments.push([a, b]);
        }
      } else if (e.type === 'arc') {
        const pts = arcSamplePoints(e, 24);
        const g = arcGeometry(e);
        if (g) add(g.cx, g.cy, 'CENTRE', 6);
        if (pts.length) {
          add(pts[0][0], pts[0][1], 'ENDPOINT', 10);
          add(pts[pts.length - 1][0], pts[pts.length - 1][1], 'ENDPOINT', 10);
        }
      } else if (e.type === 'marker' || e.type === 'text') {
        add(e.x, e.y, 'CENTRE', 8);
      } else if (e.type === 'measure' && e.points) {
        e.points.forEach((p) => add(p[0], p[1], 'ENDPOINT', 10));
        segments.push([e.points[0], e.points[1]]);
      }
    });
    return { candidates, segments };
  };

  const snapPoint = (raw, options = {}) => {
    const zoom = state.camera.zoom;
    const threshold = 10 / zoom;
    const anchor = options.anchor || null;
    const ortho = options.ortho || state.doc.ortho;
    let target = { ...raw };
    if (anchor && ortho) {
      const dx = raw.x - anchor.x;
      const dy = raw.y - anchor.y;
      if (Math.abs(dx) >= Math.abs(dy)) target = { x: raw.x, y: anchor.y };
      else target = { x: anchor.x, y: raw.y };
    }
    let best = null;
    if (state.doc.snapGeom) {
      const { candidates, segments } = collectSnapCandidates();
      candidates.forEach((candidate) => {
        if (anchor && ortho) {
          if (Math.abs(candidate.x - anchor.x) > 0.001 && Math.abs(candidate.y - anchor.y) > 0.001) return;
        }
        const d = Math.hypot(candidate.x - target.x, candidate.y - target.y);
        if (d > threshold * 1.3) return;
        const score = candidate.priority * 10 - d / threshold * 4;
        if (!best || score > best.score) best = { point: { x: candidate.x, y: candidate.y }, kind: candidate.kind, score };
      });
      let edgeBest = null;
      segments.forEach(([a, b]) => {
        const vx = b[0] - a[0], vy = b[1] - a[1];
        const len2 = vx * vx + vy * vy;
        if (!len2) return;
        let t = ((target.x - a[0]) * vx + (target.y - a[1]) * vy) / len2;
        t = clamp(t, 0, 1);
        const px = a[0] + vx * t;
        const py = a[1] + vy * t;
        if (anchor && ortho && Math.abs(px - anchor.x) > 0.001 && Math.abs(py - anchor.y) > 0.001) return;
        const d = Math.hypot(px - target.x, py - target.y);
        if (d <= threshold && (!edgeBest || d < edgeBest.d)) edgeBest = { d, point: { x: px, y: py } };
      });
      if (edgeBest) {
        const edgeScore = 3 * 10 - edgeBest.d / threshold * 4;
        if (!best || edgeScore > best.score) best = { point: edgeBest.point, kind: 'EDGE', score: edgeScore };
      }
    }
    if (best) return best;
    if (state.doc.snapGrid) {
      const grid = state.doc.gridSize || 1;
      return { point: { x: roundTo(target.x, grid), y: roundTo(target.y, grid) }, kind: 'GRID' };
    }
    return { point: target, kind: ortho && anchor ? 'ORTHO' : '' };
  };

  // ── Entity creation ──────────────────────────────────────────────────────

  const ensureLayerUsable = () => {
    const layer = layerById(state.activeLayer);
    if (!layer) {
      toast('No active layer', 'Choose a drawing layer in the library.', 'warn');
      return false;
    }
    if (layer.locked) {
      toast('Layer locked', `${layer.name} is locked. Unlock it in the Layers panel to draw.`, 'warn');
      return false;
    }
    if (layer.visible === false) {
      toast('Layer hidden', `${layer.name} is hidden. Show it before drawing.`, 'warn');
      return false;
    }
    return true;
  };

  const nextEntityName = (type) => {
    if (type === 'marker') return MARKERS[state.activeMarker]?.name || 'Marker';
    if (type === 'text') return 'Label';
    if (type === 'wall') return 'Wall';
    const base = {
      line: 'Line', polyline: 'Polyline', rect: 'Rectangle', circle: 'Circle',
      ellipse: 'Ellipse', polygon: 'Polygon', arc: 'Arc', measure: 'Dimension'
    }[type] || 'Object';
    const count = state.doc.entities.filter((e) => e.type === type).length + 1;
    return `${base} ${count}`;
  };

  const applyNewStyle = (entity) => {
    const layer = layerById(state.activeLayer) || state.doc.layers[0];
    const color = layer?.color || '#c5b49d';
    return {
      id: uid('e'),
      layer: state.activeLayer,
      name: nextEntityName(entity.type),
      stroke: color,
      strokeWidth: state.settings.lineWeight,
      fill: color,
      filled: false,
      opacity: 1,
      dash: 'solid',
      rotation: 0,
      ...entity
    };
  };

  const addEntity = (entity, label = 'Draw object', select = false) => {
    state.doc.entities.push(entity);
    if (select) setSelection([entity.id], false);
    commit(label);
    updateInspector();
    renderLayers();
    updateStatus();
    scheduleDraw();
  };

  const createLineSegment = (a, b) => {
    const e = applyNewStyle({
      type: 'polyline', points: [[a.x, a.y], [b.x, b.y]], closed: false
    });
    e.strokeWidth = state.settings.lineWeight;
    state.doc.entities.push(e);
    commit('Draw line');
    renderLayers();
    updateStatus();
    scheduleDraw();
  };

  const finishChain = (closed = false) => {
    const d = state.draft;
    if (!d) return;
    if (d.tool === 'polyline' || d.tool === 'wall') {
      if (d.points.length >= 2) {
        const e = d.tool === 'wall'
          ? applyNewStyle({
            type: 'wall', points: d.points.map((p) => [p.x, p.y]), closed,
            thickness: state.settings.wallThickness, strokeWidth: state.settings.wallThickness
          })
          : applyNewStyle({
            type: 'polyline', points: d.points.map((p) => [p.x, p.y]), closed
          });
        if (d.tool === 'wall') {
          e.layer = 'walls';
          e.stroke = layerById('walls')?.color || '#c5b49d';
          e.name = nextEntityName('wall');
        }
        state.doc.entities.push(e);
        commit(d.tool === 'wall' ? 'Draw wall chain' : 'Draw polyline');
        renderLayers();
        updateStatus();
      }
    }
    state.draft = null;
    state.snap = null;
    if (!state.settings.keepActive) setTool('select');
    updatePrompt();
    updateInspector();
    scheduleDraw();
  };

  const finishShape = (entity, label) => {
    const e = applyNewStyle(entity);
    if (state.activeLayer === 'walls') e.layer = 'walls';
    if (entity.type === 'wall') e.layer = 'walls';
    state.doc.entities.push(e);
    state.draft = null;
    state.snap = null;
    commit(label);
    renderLayers();
    updateInspector();
    updateStatus();
    if (!state.settings.keepActive) setTool('select');
    updatePrompt();
    scheduleDraw();
  };

  const addMarker = (point) => {
    if (!ensureLayerUsable()) return;
    const meta = MARKERS[state.activeMarker];
    const e = applyNewStyle({
      type: 'marker', x: point.x, y: point.y, markerType: state.activeMarker,
      size: state.settings.markerSize, rotation: 0, color: meta.color
    });
    e.layer = 'props';
    e.name = meta.name;
    state.doc.entities.push(e);
    commit(`Place ${meta.name}`);
    renderLayers();
    updateStatus();
    updateInspector();
    scheduleDraw();
  };

  // ── Pointer drawing ──────────────────────────────────────────────────────

  const clickDraw = (point, event) => {
    if (!ensureLayerUsable()) return;
    const tool = state.tool;
    const shift = event.shiftKey;
    if (tool === 'marker') {
      addMarker(point);
      return;
    }
    if (tool === 'text') {
      openTextDialog(point);
      return;
    }
    if (tool === 'line' || tool === 'polyline' || tool === 'wall') {
      if (!state.draft) {
        state.draft = { tool, points: [{ ...point }], current: { ...point } };
        updatePrompt();
        scheduleDraw();
        return;
      }
      const d = state.draft;
      const last = d.points[d.points.length - 1];
      const clickClose = d.points.length >= 2 && Math.hypot(point.x - d.points[0].x, point.y - d.points[0].y) <= 12 / state.camera.zoom;
      if (clickClose) {
        finishChain(true);
        return;
      }
      if (Math.hypot(point.x - last.x, point.y - last.y) < 0.03) return;
      if (tool === 'line') {
        createLineSegment(last, point);
        state.draft.points = [{ ...point }];
        state.draft.current = { ...point };
      } else {
        d.points.push({ ...point });
        d.current = { ...point };
        d.shift = shift;
      }
      updatePrompt();
      scheduleDraw();
      return;
    }
    if (tool === 'rect' || tool === 'circle' || tool === 'ellipse' || tool === 'polygon') {
      if (!state.draft) {
        state.draft = { tool, start: { ...point }, current: { ...point }, shift };
        updatePrompt();
        scheduleDraw();
        return;
      }
      const d = state.draft;
      d.current = { ...point };
      d.shift = shift;
      if (tool === 'rect') {
        let w = point.x - d.start.x;
        let h = point.y - d.start.y;
        if (shift) {
          const size = Math.max(Math.abs(w), Math.abs(h));
          w = Math.sign(w || 1) * size;
          h = Math.sign(h || 1) * size;
        }
        if (Math.abs(w) < 0.04 || Math.abs(h) < 0.04) return;
        finishShape({
          type: 'rect', x: Math.min(d.start.x, d.start.x + w), y: Math.min(d.start.y, d.start.y + h),
          w: Math.abs(w), h: Math.abs(h), rotation: 0
        }, 'Draw rectangle');
      } else if (tool === 'ellipse') {
        let w = point.x - d.start.x;
        let h = point.y - d.start.y;
        if (shift) {
          const size = Math.max(Math.abs(w), Math.abs(h));
          w = Math.sign(w || 1) * size;
          h = Math.sign(h || 1) * size;
        }
        if (Math.abs(w) < 0.04 || Math.abs(h) < 0.04) return;
        finishShape({
          type: 'ellipse', cx: d.start.x + w / 2, cy: d.start.y + h / 2,
          rx: Math.abs(w) / 2, ry: Math.abs(h) / 2, rotation: 0
        }, 'Draw ellipse');
      } else if (tool === 'circle') {
        const r = Math.hypot(point.x - d.start.x, point.y - d.start.y);
        if (r < 0.04) return;
        finishShape({ type: 'circle', cx: d.start.x, cy: d.start.y, r, rotation: 0 }, 'Draw circle');
      } else if (tool === 'polygon') {
        const r = Math.hypot(point.x - d.start.x, point.y - d.start.y);
        if (r < 0.04) return;
        const rotation = Math.atan2(point.y - d.start.y, point.x - d.start.x) / DEG + 90;
        finishShape({
          type: 'polygon', cx: d.start.x, cy: d.start.y, r,
          sides: state.settings.polygonSides, rotation
        }, 'Draw polygon');
      }
      return;
    }
    if (tool === 'arc') {
      if (!state.draft) {
        state.draft = { tool: 'arc', points: [{ ...point }], current: { ...point } };
        updatePrompt();
        scheduleDraw();
        return;
      }
      const d = state.draft;
      if (Math.hypot(point.x - d.points[d.points.length - 1].x, point.y - d.points[d.points.length - 1].y) < 0.03) return;
      d.points.push({ ...point });
      d.current = { ...point };
      if (d.points.length === 3) {
        const test = { type: 'arc', points: d.points.map((p) => [p.x, p.y]) };
        if (!arcGeometry(test)) {
          toast('Cannot form an arc', 'Those three points are collinear. Try again.', 'warn');
          d.points = d.points.slice(0, 2);
          return;
        }
        finishShape({
          type: 'arc', points: d.points.map((p) => [p.x, p.y])
        }, 'Draw arc');
      } else {
        updatePrompt();
        scheduleDraw();
      }
      return;
    }
    if (tool === 'measure') {
      if (!state.draft) {
        state.draft = { tool: 'measure', start: { ...point }, current: { ...point } };
        updatePrompt();
        scheduleDraw();
        return;
      }
      const d = state.draft;
      if (Math.hypot(point.x - d.start.x, point.y - d.start.y) < 0.04) return;
      const e = applyNewStyle({
        type: 'measure', points: [[d.start.x, d.start.y], [point.x, point.y]]
      });
      e.stroke = '#7ed8cf';
      e.strokeWidth = 0.06;
      e.layer = 'labels';
      e.name = nextEntityName('measure');
      state.doc.entities.push(e);
      state.draft = null;
      state.snap = null;
      commit('Add dimension');
      renderLayers();
      updateStatus();
      updateInspector();
      if (!state.settings.keepActive) setTool('select');
      updatePrompt();
      scheduleDraw();
    }
  };

  // ── Pointer interaction ──────────────────────────────────────────────────

  const HANDLE_VECTORS = {
    nw: [-0.5, -0.5], n: [0, -0.5], ne: [0.5, -0.5], e: [0.5, 0],
    se: [0.5, 0.5], s: [0, 0.5], sw: [-0.5, 0.5], w: [-0.5, 0]
  };

  const HANDLE_CURSORS = {
    nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize',
    n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize'
  };

  const pointerFromEvent = (event) => {
    const rect = canvas.getBoundingClientRect();
    const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    return { screen, world: screenToWorld(screen.x, screen.y) };
  };

  const updateCoordinateReadout = () => {
    $('#coordX').textContent = formatNum(state.pointerWorld.x, 2);
    $('#coordY').textContent = formatNum(state.pointerWorld.y, 2);
  };

  const pickEntity = (point, ignoreGroup = false) => {
    const tolerance = 7 / state.camera.zoom;
    const entities = getDrawOrder().filter((e) => isLayerVisible(e.layer) && !isLayerLocked(e.layer));
    const p = [point.x, point.y];
    for (let i = entities.length - 1; i >= 0; i -= 1) {
      if (hitEntity(entities[i], p, tolerance)) return entities[i];
    }
    for (let i = entities.length - 1; i >= 0; i -= 1) {
      if (hitEntityInterior(entities[i], p)) return entities[i];
    }
    return null;
  };

  const handleAt = (screen) => {
    let best = null;
    state.handleAreas.forEach((area) => {
      const d = Math.hypot(screen.x - area.x, screen.y - area.y);
      if (d <= area.r && (!best || d < best.d)) best = { ...area, d };
    });
    return best;
  };

  const selectionFrameFor = (selected) => {
    const bounds = unionBounds(selected);
    if (!bounds) return null;
    const single = selected.length === 1 ? selected[0] : null;
    const isShape = single && (SHAPE_TYPES.has(single.type) || single.type === 'text' || single.type === 'marker');
    if (isShape) return { ...entityFrame(single), single: true };
    return {
      cx: bounds.x + bounds.w / 2, cy: bounds.y + bounds.h / 2,
      w: bounds.w, h: bounds.h, rot: 0, single: false
    };
  };

  const snapshotSelection = () => selectedEntities().map((e) => ({ id: e.id, data: deepClone(e) }));

  const restoreSnapshot = (entity, snapshot) => {
    Object.keys(entity).forEach((key) => {
      if (!(key in snapshot)) delete entity[key];
    });
    Object.assign(entity, deepClone(snapshot));
  };

  const dragAnchorPoint = () => {
    const d = state.draft;
    if (!d) return null;
    if (d.points?.length) return d.points[d.points.length - 1];
    if (d.start) return d.start;
    return null;
  };

  const snapForPointer = (event, raw) => {
    const tool = state.tool;
    const anchor = dragAnchorPoint();
    const wantsSnap = !['select', 'pan'].includes(tool) || Boolean(state.drag);
    if (!wantsSnap) return raw;
    const ortho = event.shiftKey || state.doc.ortho;
    const snapped = snapPoint(raw, { anchor, ortho });
    if (snapped.kind) state.snap = snapped;
    else state.snap = null;
    return snapped.point;
  };

  const beginPan = (pointer) => {
    state.pan = {
      startScreen: { ...pointer.screen },
      cameraX: state.camera.x,
      cameraY: state.camera.y
    };
    state.isPanning = true;
    canvas.classList.add('is-panning');
  };

  const beginEntityDrag = (pointer, entity, additive) => {
    const ids = entityGroupIds(entity, additive && pointer.alt);
    if (pointer.alt && entity.groupId) setSelection([entity.id], false);
    else if (!state.selection.has(entity.id)) setSelection(additive ? [...state.selection, ...ids] : ids, false);
    const selected = selectedEntities();
    state.drag = {
      kind: 'move',
      startWorld: { ...pointer.world },
      startScreen: { ...pointer.screen },
      snapshots: selected.map((e) => ({ id: e.id, data: deepClone(e) })),
      moved: false
    };
    updateInspector();
    updateStatus();
    scheduleDraw();
  };

  const beginHandleDrag = (pointer, handle) => {
    const selected = selectedEntities();
    const frame = selectionFrameFor(selected);
    if (!frame) return;
    if (handle.kind === 'node') {
      const e = selected[0];
      state.drag = {
        kind: 'node', id: e.id, index: handle.index, entityType: e.type,
        snapshot: deepClone(e), moved: false
      };
      return;
    }
    if (handle.kind === 'rotate') {
      state.drag = {
        kind: 'rotate',
        frame,
        center: { x: frame.cx, y: frame.cy },
        startAngle: Math.atan2(pointer.world.y - frame.cy, pointer.world.x - frame.cx),
        snapshots: snapshotSelection(),
        moved: false
      };
      return;
    }
    const vec = HANDLE_VECTORS[handle.key] || [-0.5, -0.5];
    const opp = { x: -vec[0] * frame.w, y: -vec[1] * frame.h };
    const startLocal = rotatePoint(pointer.world.x, pointer.world.y, frame.cx, frame.cy, -frame.rot);
    state.drag = {
      kind: 'scale',
      frame,
      vec,
      opp,
      startLocal: { x: startLocal.x - frame.cx, y: startLocal.y - frame.cy },
      snapshots: snapshotSelection(),
      moved: false
    };
  };

  const applyScaleToShape = (e, drag, sx, sy) => {
    const frame = drag.frame;
    const vec = drag.vec;
    const absX = Math.abs(sx);
    const absY = Math.abs(sy);
    const localCenter = { x: drag.opp.x * (1 - sx), y: drag.opp.y * (1 - sy) };
    const center = rotatePoint(
      frame.cx + localCenter.x, frame.cy + localCenter.y,
      frame.cx, frame.cy, frame.rot
    );
    const uniform = vec[0] !== 0 && vec[1] !== 0
      ? Math.max(absX, absY)
      : (vec[0] !== 0 ? absX : absY);
    if (e.type === 'rect') {
      e.w = Math.max(0.05, frame.w * absX);
      e.h = Math.max(0.05, frame.h * absY);
      e.x = center.x - e.w / 2;
      e.y = center.y - e.h / 2;
    } else if (e.type === 'ellipse') {
      e.rx = Math.max(0.02, (frame.w * absX) / 2);
      e.ry = Math.max(0.02, (frame.h * absY) / 2);
      e.cx = center.x;
      e.cy = center.y;
    } else if (e.type === 'circle') {
      e.r = Math.max(0.02, (frame.w / 2) * uniform);
      e.cx = center.x;
      e.cy = center.y;
    } else if (e.type === 'polygon') {
      e.r = Math.max(0.02, (frame.w / 2) * uniform);
      e.cx = center.x;
      e.cy = center.y;
    } else if (e.type === 'marker') {
      e.size = Math.max(0.12, (frame.w || e.size) * uniform);
      e.x = center.x;
      e.y = center.y;
    } else if (e.type === 'text') {
      e.fontSize = Math.max(0.12, (e.fontSize || 0.8) * uniform);
      e.x = center.x;
      e.y = center.y;
    }
  };

  const scaleEntityWorld = (e, opp, sx, sy) => {
    const absX = Math.abs(sx);
    const absY = Math.abs(sy);
    const uniform = (absX + absY) / 2;
    const mapPoint = (x, y) => [opp.x + (x - opp.x) * sx, opp.y + (y - opp.y) * sy];
    if (PATH_TYPES.has(e.type) || e.type === 'arc' || e.type === 'measure') {
      e.points = (e.points || []).map((p) => mapPoint(p[0], p[1]));
    } else if (e.type === 'rect') {
      const x1 = opp.x + (e.x - opp.x) * sx;
      const x2 = opp.x + (e.x + e.w - opp.x) * sx;
      const y1 = opp.y + (e.y - opp.y) * sy;
      const y2 = opp.y + (e.y + e.h - opp.y) * sy;
      e.x = Math.min(x1, x2);
      e.y = Math.min(y1, y2);
      e.w = Math.max(0.05, Math.abs(x2 - x1));
      e.h = Math.max(0.05, Math.abs(y2 - y1));
    } else if (e.type === 'circle') {
      const p = mapPoint(e.cx, e.cy);
      e.cx = p[0];
      e.cy = p[1];
      e.r = Math.max(0.02, e.r * uniform);
    } else if (e.type === 'ellipse') {
      const p = mapPoint(e.cx, e.cy);
      e.cx = p[0];
      e.cy = p[1];
      e.rx = Math.max(0.02, e.rx * absX);
      e.ry = Math.max(0.02, e.ry * absY);
    } else if (e.type === 'polygon') {
      const p = mapPoint(e.cx, e.cy);
      e.cx = p[0];
      e.cy = p[1];
      e.r = Math.max(0.02, e.r * uniform);
    } else if (e.type === 'marker') {
      const p = mapPoint(e.x, e.y);
      e.x = p[0];
      e.y = p[1];
      e.size = Math.max(0.12, e.size * uniform);
    } else if (e.type === 'text') {
      const p = mapPoint(e.x, e.y);
      e.x = p[0];
      e.y = p[1];
      e.fontSize = Math.max(0.12, (e.fontSize || 0.8) * uniform);
    }
  };

  const updateDrag = (pointer, event) => {
    const drag = state.drag;
    if (!drag) return;

    if (drag.kind === 'node') {
      const entity = state.doc.entities.find((e) => e.id === drag.id);
      if (!entity) return;
      const pts = drag.snapshot.points || [];
      const prev = drag.index > 0 ? pts[drag.index - 1] : pts[pts.length - 1];
      const snapped = snapPoint(pointer.world, {
        anchor: prev ? { x: prev[0], y: prev[1] } : null,
        ortho: event.shiftKey || state.doc.ortho
      });
      state.snap = snapped.kind ? snapped : null;
      restoreSnapshot(entity, drag.snapshot);
      if (entity.points?.[drag.index]) {
        entity.points[drag.index] = [snapped.point.x, snapped.point.y];
      }
      drag.moved = true;
      updateCoordinateReadout();
      scheduleDraw();
      return;
    }

    const ids = new Set((drag.snapshots || []).map((s) => s.id));
    const entities = state.doc.entities.filter((e) => ids.has(e.id));
    if (!entities.length) return;

    if (drag.kind === 'move') {
      let dx = pointer.world.x - drag.startWorld.x;
      let dy = pointer.world.y - drag.startWorld.y;
      if (event.shiftKey || state.doc.ortho) {
        if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      if (state.doc.snapGrid) {
        const grid = state.doc.gridSize || 1;
        dx = roundTo(dx, grid);
        dy = roundTo(dy, grid);
      }
      drag.snapshots.forEach((snap) => {
        const entity = state.doc.entities.find((e) => e.id === snap.id);
        if (!entity) return;
        restoreSnapshot(entity, snap.data);
        translateEntity(entity, dx, dy);
      });
      drag.moved = drag.moved || Math.hypot(pointer.screen.x - drag.startScreen.x, pointer.screen.y - drag.startScreen.y) > 2;
      state.snap = {
        point: { x: drag.startWorld.x + dx, y: drag.startWorld.y + dy }, kind: 'MOVE'
      };
    } else if (drag.kind === 'scale') {
      const frame = drag.frame;
      const current = rotatePoint(pointer.world.x, pointer.world.y, frame.cx, frame.cy, -frame.rot);
      const currentLocal = { x: current.x - frame.cx, y: current.y - frame.cy };
      let sx = 1;
      let sy = 1;
      if (drag.vec[0] !== 0) {
        const denom = drag.startLocal.x - drag.opp.x;
        sx = Math.abs(denom) > 0.0001 ? (currentLocal.x - drag.opp.x) / denom : 1;
      }
      if (drag.vec[1] !== 0) {
        const denom = drag.startLocal.y - drag.opp.y;
        sy = Math.abs(denom) > 0.0001 ? (currentLocal.y - drag.opp.y) / denom : 1;
      }
      if (event.shiftKey) {
        const uniform = Math.max(Math.abs(sx), Math.abs(sy));
        sx = Math.sign(sx || 1) * uniform;
        sy = Math.sign(sy || 1) * uniform;
      }
      sx = Math.sign(sx || 1) * Math.max(0.04, Math.abs(sx));
      sy = Math.sign(sy || 1) * Math.max(0.04, Math.abs(sy));
      drag.snapshots.forEach((snap) => {
        const entity = state.doc.entities.find((e) => e.id === snap.id);
        if (!entity) return;
        restoreSnapshot(entity, snap.data);
        if (drag.frame.single) applyScaleToShape(entity, drag, sx, sy);
        else scaleEntityWorld(entity, {
          x: frame.cx + drag.opp.x,
          y: frame.cy + drag.opp.y
        }, sx, sy);
      });
      drag.moved = true;
      state.snap = null;
    } else if (drag.kind === 'rotate') {
      let delta = (Math.atan2(pointer.world.y - drag.center.y, pointer.world.x - drag.center.x) - drag.startAngle) / DEG;
      if (event.shiftKey) delta = Math.round(delta / 15) * 15;
      drag.snapshots.forEach((snap) => {
        const entity = state.doc.entities.find((e) => e.id === snap.id);
        if (!entity) return;
        restoreSnapshot(entity, snap.data);
        rotateEntityAround(entity, drag.center, delta);
      });
      drag.moved = true;
      state.snap = null;
    }
    updateCoordinateReadout();
    scheduleDraw();
  };

  const finishMarquee = (marquee, event) => {
    const minX = Math.min(marquee.x0, marquee.x1);
    const maxX = Math.max(marquee.x0, marquee.x1);
    const minY = Math.min(marquee.y0, marquee.y1);
    const maxY = Math.max(marquee.y0, marquee.y1);
    const tiny = Math.abs(maxX - minX) < 0.08 && Math.abs(maxY - minY) < 0.08;
    if (tiny) {
      if (!event.shiftKey) setSelection([]);
      return;
    }
    const hits = getDrawOrder().filter((e) => {
      if (!isLayerVisible(e.layer) || isLayerLocked(e.layer)) return false;
      const b = getEntityBounds(e);
      if (!b) return false;
      return b.x <= maxX && b.x + b.w >= minX && b.y <= maxY && b.y + b.h >= minY;
    });
    const ids = new Set();
    hits.forEach((e) => {
      const groupIds = event.altKey ? [e.id] : entityGroupIds(e);
      groupIds.forEach((id) => ids.add(id));
    });
    if (event.shiftKey) marquee.base.forEach((id) => ids.add(id));
    setSelection([...ids]);
  };

  // ── Long-press actions (touch) ───────────────────────────────────────────

  let longPressTimer = null;
  let longPressStart = null;

  const cancelLongPress = () => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    longPressStart = null;
  };

  const hideTouchActions = () => {
    const bar = $('#touchActions');
    if (bar && !bar.hidden) bar.hidden = true;
  };

  const showTouchActions = (screen) => {
    const bar = $('#touchActions');
    if (!bar) return;
    const count = state.selection.size;
    $('#touchDeleteLabel').textContent = count > 1 ? `DELETE ${count}` : 'DELETE';
    bar.hidden = false;
    bar.classList.remove('is-below');
    const width = bar.offsetWidth;
    const height = bar.offsetHeight;
    const half = width / 2;
    const margin = 10;
    const maxX = Math.max(half + margin, state.view.w - half - margin);
    const x = clamp(screen.x, half + margin, maxX);
    let y = screen.y - 12;
    const below = y - height - margin < 8;
    if (below) y = screen.y + 18;
    bar.style.left = `${x}px`;
    bar.style.top = `${y}px`;
    bar.classList.toggle('is-below', below);
  };

  const startLongPress = (event, pointer) => {
    if (!isPhoneLayout() || event.pointerType !== 'touch' || state.tool !== 'select') return;
    cancelLongPress();
    longPressStart = { x: pointer.screen.x, y: pointer.screen.y, pointerId: event.pointerId };
    longPressTimer = setTimeout(() => {
      longPressTimer = null;
      if (!longPressStart || !state.touchPoints.has(longPressStart.pointerId) || state.pinch) return;
      longPressStart = null;
      cancelDrag();
      hideTouchActions();
      showTouchActions(pointer.screen);
      if (typeof navigator.vibrate === 'function') {
        try { navigator.vibrate(25); } catch (error) { /* Optional. */ }
      }
    }, 520);
  };

  const onPointerDown = (event) => {
    if (!state.doc) return;
    if (event.button !== 0 && event.button !== 1) return;
    const pointer = pointerFromEvent(event);
    state.pointerScreen = pointer.screen;
    state.pointerWorld = pointer.world;
    updateCoordinateReadout();
    pointer.alt = event.altKey;

    if (event.pointerType === 'touch') {
      state.touchPoints.set(event.pointerId, { x: pointer.screen.x, y: pointer.screen.y });
      if (state.touchPoints.size >= 2) {
        event.preventDefault();
        cancelLongPress();
        if (!state.pinch) {
          cancelDrag();
          state.marquee = null;
          state.pan = null;
          state.isPanning = false;
          canvas.classList.remove('is-panning');
          const pts = [...state.touchPoints.values()];
          const center = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
          const dist = Math.max(1, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y));
          state.pinch = { dist, zoom: state.camera.zoom, world: screenToWorld(center.x, center.y) };
        }
        updateStatus();
        scheduleDraw();
        return;
      }
    }

    try {
      canvas.setPointerCapture?.(event.pointerId);
    } catch (error) {
      // Pointer capture is a progressive enhancement.
    }
    const wantsPan = event.button === 1 || state.spaceDown || state.tool === 'pan';

    if (wantsPan) {
      event.preventDefault();
      beginPan(pointer);
      return;
    }

    if (state.tool !== 'select') {
      if (event.button !== 0) return;
      const target = snapForPointer(event, pointer.world);
      state.pointerWorld = target;
      updateCoordinateReadout();
      clickDraw(target, event);
      return;
    }

    if (event.button !== 0) return;
    const handle = handleAt(pointer.screen);
    if (handle) {
      event.preventDefault();
      beginHandleDrag(pointer, handle);
      return;
    }
    const picked = pickEntity(pointer.world, event.altKey);
    if (picked) {
      if (event.shiftKey && state.selection.has(picked.id)) {
        toggleSelectionGroup(entityGroupIds(picked, event.altKey));
        return;
      }
      beginEntityDrag(pointer, picked, event.shiftKey);
      startLongPress(event, pointer);
      return;
    }
    if (!event.shiftKey) setSelection([]);
    state.marquee = {
      x0: pointer.world.x, y0: pointer.world.y,
      x1: pointer.world.x, y1: pointer.world.y,
      base: new Set(state.selection)
    };
    scheduleDraw();
  };

  const onPointerMove = (event) => {
    if (!state.doc) return;
    const pointer = pointerFromEvent(event);
    state.pointerScreen = pointer.screen;
    let world = pointer.world;

    if (longPressStart && event.pointerType === 'touch'
      && Math.hypot(pointer.screen.x - longPressStart.x, pointer.screen.y - longPressStart.y) > 10) {
      cancelLongPress();
    }

    if (event.pointerType === 'touch' && state.touchPoints.has(event.pointerId)) {
      state.touchPoints.set(event.pointerId, { x: pointer.screen.x, y: pointer.screen.y });
    }
    if (state.pinch && state.touchPoints.size >= 2) {
      const pts = [...state.touchPoints.values()];
      const center = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      const dist = Math.max(1, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y));
      const zoom = clamp(state.pinch.zoom * (dist / state.pinch.dist), 2, 80);
      state.camera.zoom = zoom;
      state.camera.x = center.x - state.pinch.world.x * zoom;
      state.camera.y = center.y - state.pinch.world.y * zoom;
      updateStatus();
      scheduleDraw();
      return;
    }

    if (state.pan) {
      state.camera.x = state.pan.cameraX + (pointer.screen.x - state.pan.startScreen.x);
      state.camera.y = state.pan.cameraY + (pointer.screen.y - state.pan.startScreen.y);
      updateStatus();
      scheduleDraw();
      return;
    }

    if (state.drag) {
      world = snapForPointer(event, pointer.world);
      state.pointerWorld = world;
      updateDrag(pointer, event);
      return;
    }

    if (state.marquee) {
      state.marquee.x1 = world.x;
      state.marquee.y1 = world.y;
      state.pointerWorld = world;
      updateCoordinateReadout();
      scheduleDraw();
      return;
    }

    if (state.tool === 'select') {
      const handle = handleAt(pointer.screen);
      state.hoverHandle = handle;
      const picked = handle ? null : pickEntity(world, event.altKey);
      state.hoverEntity = picked;
      if (handle) {
        canvas.style.cursor = handle.kind === 'rotate' ? 'grab'
          : handle.kind === 'node' ? 'pointer'
            : (HANDLE_CURSORS[handle.key] || 'nwse-resize');
      } else if (picked) {
        canvas.style.cursor = 'move';
      } else {
        canvas.style.cursor = 'default';
      }
      state.snap = null;
      state.pointerWorld = world;
      updateCoordinateReadout();
      scheduleDraw();
      return;
    }

    if (state.tool === 'pan') {
      state.pointerWorld = world;
      updateCoordinateReadout();
      return;
    }

    world = snapForPointer(event, world);
    state.pointerWorld = world;
    state.hoverEntity = null;
    const d = state.draft;
    if (d) {
      if (d.tool === 'line' || d.tool === 'polyline' || d.tool === 'wall') {
        d.current = { ...world };
        d.shift = event.shiftKey;
      } else if (d.tool === 'rect' || d.tool === 'circle' || d.tool === 'ellipse' || d.tool === 'polygon') {
        d.current = { ...world };
        d.shift = event.shiftKey;
      } else if (d.tool === 'arc') {
        d.current = { ...world };
      } else if (d.tool === 'measure') {
        d.current = { ...world };
      }
    }
    updateCoordinateReadout();
    scheduleDraw();
  };

  const onPointerUp = (event) => {
    cancelLongPress();
    try {
      if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    } catch (error) {
      // Ignore capture release errors.
    }
    if (event.pointerType === 'touch') {
      state.touchPoints.delete(event.pointerId);
      if (state.pinch) {
        if (state.touchPoints.size < 2) state.pinch = null;
        updateStatus();
        scheduleDraw();
        return;
      }
    }
    if (state.pan) {
      state.pan = null;
      state.isPanning = false;
      canvas.classList.remove('is-panning');
      updateStatus();
      scheduleDraw();
      return;
    }
    if (state.marquee) {
      const marquee = state.marquee;
      state.marquee = null;
      finishMarquee(marquee, event);
      updateCoordinateReadout();
      scheduleDraw();
      return;
    }
    if (state.drag) {
      const drag = state.drag;
      state.drag = null;
      state.snap = null;
      if (drag.moved) {
        const labels = {
          move: 'Move selection', scale: 'Scale selection', rotate: 'Rotate selection', node: 'Edit node'
        };
        commit(labels[drag.kind] || 'Edit geometry');
        updateInspector();
        renderLayers();
      }
      updateStatus();
      scheduleDraw();
    }
  };

  const cancelDrag = () => {
    const drag = state.drag;
    if (!drag) return false;
    if (drag.kind === 'node' && drag.snapshot) {
      const entity = state.doc.entities.find((e) => e.id === drag.id);
      if (entity) restoreSnapshot(entity, drag.snapshot);
    } else if (drag.snapshots) {
      drag.snapshots.forEach((snap) => {
        const entity = state.doc.entities.find((e) => e.id === snap.id);
        if (entity) restoreSnapshot(entity, snap.data);
      });
    }
    state.drag = null;
    state.snap = null;
    updateInspector();
    updateStatus();
    scheduleDraw();
    return true;
  };

  const onPointerCancel = (event) => {
    cancelLongPress();
    hideTouchActions();
    if (event?.pointerType === 'touch') {
      state.touchPoints.delete(event.pointerId);
      if (state.touchPoints.size < 2) state.pinch = null;
    }
    if (state.pan) {
      state.pan = null;
      state.isPanning = false;
      canvas.classList.remove('is-panning');
    }
    cancelDrag();
    state.marquee = null;
    state.snap = null;
    scheduleDraw();
  };

  const onWheel = (event) => {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;
    const factor = Math.exp(-event.deltaY * 0.0014);
    zoomAt(factor, screenX, screenY);
  };

  const onContextMenu = (event) => {
    event.preventDefault();
    if (state.draft) {
      finishChain(false);
      return;
    }
    if (state.tool !== 'select') setTool('select');
  };

  const onDoubleClick = (event) => {
    if (!state.doc) return;
    const pointer = pointerFromEvent(event);
    const picked = pickEntity(pointer.world, true);
    if (picked) {
      setSelection([picked.id]);
      toast('Object selected', picked.name || TYPE_LABEL[picked.type] || 'Object');
    }
  };

  // ── Preset materialisation ───────────────────────────────────────────────

  const materializePreset = (preset, cx, cy, rotation = 0, groupName = preset.name) => {
    const bounds = unionBounds(preset.objects);
    if (!bounds) return [];
    const originX = bounds.x + bounds.w / 2;
    const originY = bounds.y + bounds.h / 2;
    const groupId = uid('g');
    return preset.objects.map((source) => {
      const entity = normalizeEntity(deepClone(source));
      entity.id = uid('e');
      entity.groupId = groupId;
      entity.groupName = groupName;
      translateEntity(entity, -originX, -originY);
      if (rotation) rotateEntityAround(entity, { x: 0, y: 0 }, rotation);
      translateEntity(entity, cx, cy);
      return entity;
    });
  };

  const insertPreset = (preset, point = null) => {
    if (!state.doc) return;
    if (!point) point = screenToWorld(state.view.w / 2, (state.view.h - 56) / 2);
    if (state.doc.snapGrid) {
      const grid = state.doc.gridSize || 1;
      point = { x: roundTo(point.x, grid), y: roundTo(point.y, grid) };
    }
    const entities = materializePreset(preset, point.x, point.y);
    if (!entities.length) return;
    state.doc.entities.push(...entities);
    setSelection(entities.map((e) => e.id), false);
    commit(`Insert ${preset.name}`);
    renderLayers();
    updateInspector();
    updateStatus();
    updatePrompt();
    scheduleDraw();
    toast('Preset inserted', `${preset.name} · ${entities.length} editable objects.`);
  };

  const findPreset = (query) => {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return null;
    return PRESETS.find((p) => p.id === q)
      || PRESETS.find((p) => p.name.toLowerCase() === q)
      || PRESETS.find((p) => p.name.toLowerCase().includes(q) || p.id.includes(q));
  };

  // ── Tools, text dialog and command line ──────────────────────────────────

  const setTool = (tool) => {
    if (!TOOLS[tool]) return;
    if (state.draft) {
      state.draft = null;
      state.snap = null;
    }
    state.tool = tool;
    state.hoverEntity = null;
    state.hoverHandle = null;
    if (TOOL_LAYER[tool] && state.doc) {
      state.activeLayer = TOOL_LAYER[tool];
      renderLayers();
    }
    if (tool === 'marker') renderProps();
    canvas.style.cursor = '';
    updateMode();
    updatePrompt();
    updateStatus();
    scheduleDraw();
  };

  const toggleSnapSetting = (key) => {
    if (!state.doc) return;
    state.doc[key] = !state.doc[key];
    commit(`${key} toggle`);
    updateStatus();
    updateInspector();
    scheduleDraw();
  };

  const openTextDialog = (point) => {
    state.textPoint = { ...point };
    const dialog = $('#textDialog');
    const input = $('#textInput');
    input.value = '';
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    setTimeout(() => input.focus(), 30);
  };

  const placeTextLabel = () => {
    if (!state.textPoint) return;
    const text = $('#textInput').value.trim();
    if (!text) {
      toast('Label is empty', 'Type a short annotation before placing it.', 'warn');
      return;
    }
    const e = applyNewStyle({
      type: 'text', x: state.textPoint.x, y: state.textPoint.y,
      text, fontSize: state.settings.fontSize, rotation: 0,
      color: '#b9b3a6', opacity: 0.92
    });
    e.layer = 'labels';
    e.name = text.slice(0, 42);
    state.doc.entities.push(e);
    state.textPoint = null;
    commit('Add label');
    renderLayers();
    updateInspector();
    updateStatus();
    if (!state.settings.keepActive) setTool('select');
    updatePrompt();
    scheduleDraw();
  };

  const chooseMarker = (query) => {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return false;
    const entry = Object.entries(MARKERS).find(([key, marker]) => key === q || marker.name.toLowerCase() === q)
      || Object.entries(MARKERS).find(([key, marker]) => key.includes(q) || marker.name.toLowerCase().includes(q));
    if (!entry) return false;
    state.activeMarker = entry[0];
    setTool('marker');
    renderProps();
    renderToolOptions();
    return true;
  };

  // ── Traverse survey ───────────────────────────────────────────────────────

  const SURVEY_MAX_SEGMENTS = 400;

  const parseSurveyLength = (token) => {
    const match = String(token).trim().match(/^([+-]?(?:\d+(?:\.\d+)?|\.\d+))m?$/i);
    if (!match) return null;
    const value = Number(match[1]);
    return Number.isFinite(value) ? value : null;
  };

  const parseSurveyTurn = (token, allowBare = false) => {
    const text = String(token).trim();
    if (!text) return null;
    let match = text.match(/^([RLT])([+-]?(?:\d+(?:\.\d+)?|\.\d+)?)$/i);
    if (match) {
      const direction = match[1].toUpperCase() === 'L' ? -1 : 1;
      const degrees = match[2] ? Number(match[2]) : 90;
      return Number.isFinite(degrees) ? direction * degrees : null;
    }
    match = text.match(/^([+-])(\d+(?:\.\d+)?|\.\d+)$/);
    if (match) return (match[1] === '-' ? -1 : 1) * Number(match[2]);
    if (allowBare) {
      match = text.match(/^(\d+(?:\.\d+)?|\.\d+)$/);
      if (match) return Number(match[1]);
    }
    return null;
  };

  const stripSurveyComment = (line) => line.replace(/\s*(?:#|\/\/).*$/, '').trim();

  const parseSurveyCsv = (raw) => {
    const rows = [];
    String(raw).split(/\r?\n/).forEach((line, lineIndex) => {
      const clean = stripSurveyComment(line);
      if (!clean) return;
      const cells = clean.split(',').map((cell) => cell.trim());
      if (cells.length > 2 && cells.slice(2).some(Boolean)) {
        rows.push({ error: `Line ${lineIndex + 1}: use one distance and one turn per line.` });
        return;
      }
      const length = parseSurveyLength(cells[0]);
      if (length === null) {
        if (!rows.length && /distance|length|segment|turn|deg/i.test(cells[0])) return;
        rows.push({ error: `Line ${lineIndex + 1}: “${cells[0]}” is not a distance.` });
        return;
      }
      if (!(length > 0)) {
        rows.push({ error: `Line ${lineIndex + 1}: distance must be greater than zero.` });
        return;
      }
      if (length > 10000) {
        rows.push({ error: `Line ${lineIndex + 1}: keep distances under 10,000 m.` });
        return;
      }
      const turnToken = cells[1] || '';
      const turn = turnToken ? parseSurveyTurn(turnToken, true) : null;
      if (turnToken && turn === null) {
        rows.push({ error: `Line ${lineIndex + 1}: “${turnToken}” is not a turn.` });
        return;
      }
      if (turn !== null && Math.abs(turn) > 3600) {
        rows.push({ error: `Line ${lineIndex + 1}: turns must stay under 3,600°.` });
        return;
      }
      rows.push({ length, turn, line: lineIndex + 1 });
    });
    if (!rows.length) return { error: 'Enter at least one distance.' };
    if (rows.length > SURVEY_MAX_SEGMENTS) return { error: `Keep it under ${SURVEY_MAX_SEGMENTS} segments.` };
    const failed = rows.find((row) => row.error);
    if (failed) return { error: failed.error };
    rows.forEach((row, index) => {
      if (row.turn !== null && row.turn !== undefined) return;
      if (index === rows.length - 1) row.turn = 0;
      else row.error = `Line ${row.line}: add a turn such as R90 or -90.`;
    });
    const turnError = rows.find((row) => row.error);
    if (turnError) return { error: turnError.error };
    return { segments: rows.map(({ length, turn }) => ({ length, turn })) };
  };

  const parseSurveyText = (raw) => {
    const text = String(raw || '');
    if (!text.trim()) return { error: 'Enter at least one distance.' };
    if (text.includes(',')) return parseSurveyCsv(text);

    const tokens = text
      .split(/\r?\n/)
      .map(stripSurveyComment)
      .filter(Boolean)
      .join(' ')
      .split(/[\s;]+/)
      .filter(Boolean);
    if (!tokens.length) return { error: 'Enter at least one distance.' };
    if (tokens.length > SURVEY_MAX_SEGMENTS * 2) return { error: `Keep it under ${SURVEY_MAX_SEGMENTS} segments.` };

    if (tokens.every((token) => parseSurveyLength(token) !== null)) {
      const segments = tokens.map((token, index) => ({
        length: parseSurveyLength(token),
        turn: index === tokens.length - 1 ? 0 : 90
      }));
      if (segments.some((segment) => !(segment.length > 0))) {
        return { error: 'Distances must be greater than zero.' };
      }
      return { segments, warning: 'Lengths only — assuming a 90° right turn between sides.' };
    }

    const segments = [];
    let index = 0;
    while (index < tokens.length) {
      const lengthToken = tokens[index];
      const length = parseSurveyLength(lengthToken);
      if (length === null) return { error: `“${lengthToken}” is not a distance. Example: 12 R90.` };
      if (!(length > 0)) return { error: 'Distances must be greater than zero.' };
      if (length > 10000) return { error: 'Keep distances under 10,000 m.' };
      index += 1;

      let turn = 0;
      if (index < tokens.length) {
        const turnToken = tokens[index];
        const parsedTurn = parseSurveyTurn(turnToken);
        if (parsedTurn === null) {
          return { error: `After ${lengthToken} m, expected a turn like R90 or L45, not “${turnToken}”.` };
        }
        if (Math.abs(parsedTurn) > 3600) return { error: 'Turns must stay under 3,600°.' };
        turn = parsedTurn;
        index += 1;
      }
      segments.push({ length, turn });
      if (segments.length > SURVEY_MAX_SEGMENTS) return { error: `Keep it under ${SURVEY_MAX_SEGMENTS} segments.` };
    }
    return { segments };
  };

  const buildSurvey = (segments, options) => {
    const grid = Math.max(0.05, Number(options.gridSize) || 1);
    const snap = Boolean(options.snap);
    let heading = (Number(options.heading) || 0) * DEG;
    let x = Number(options.startX) || 0;
    let y = Number(options.startY) || 0;
    const points = [[x, y]];
    let perimeter = 0;

    segments.forEach((segment) => {
      const length = snap ? Math.max(grid, roundTo(segment.length, grid)) : segment.length;
      x += Math.cos(heading) * length;
      y += Math.sin(heading) * length;
      perimeter += length;
      points.push([Number(x.toFixed(4)), Number(y.toFixed(4))]);
      heading += segment.turn * DEG;
    });

    const start = points[0];
    const end = points[points.length - 1];
    const gap = Math.hypot(end[0] - start[0], end[1] - start[1]);
    let area = 0;
    if (options.closeLoop && points.length > 2) {
      for (let i = 0; i < points.length; i += 1) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        area += a[0] * b[1] - b[0] * a[1];
      }
      area = Math.abs(area) / 2;
    }

    return {
      points,
      perimeter,
      gap,
      area,
      closed: Boolean(options.closeLoop),
      total: perimeter + (options.closeLoop && gap > 0.0001 ? gap : 0)
    };
  };

  const readSurveyForm = () => {
    const numberField = (selector) => {
      const value = Number($(selector).value);
      return Number.isFinite(value) ? value : 0;
    };
    return {
      closeLoop: Boolean($('#surveyCloseLoop').checked),
      snap: Boolean($('#surveySnap').checked),
      startX: numberField('#surveyStartX'),
      startY: numberField('#surveyStartY'),
      heading: numberField('#surveyHeading'),
      gridSize: state.doc?.gridSize || 1
    };
  };

  const setSurveyStats = (result, count) => {
    $('#surveyPerimeter').textContent = result ? result.total.toFixed(1) : '—';
    $('#surveyArea').textContent = result && result.closed ? result.area.toFixed(1) : '—';
    $('#surveyCorners').textContent = result ? String(count) : '—';
    const gap = $('#surveyGap');
    if (!result) {
      gap.textContent = '';
      return;
    }
    if (result.closed) {
      gap.textContent = result.gap > 0.05
        ? `Closes with a ${result.gap.toFixed(1)} m connector`
        : 'Loop closes cleanly';
    } else {
      gap.textContent = result.gap > 0.05
        ? `Open path · ${result.gap.toFixed(1)} m back to start`
        : 'Open path';
    }
  };

  const renderSurveyPreview = (result, form) => {
    const svg = $('#surveyPreviewSvg');
    const points = result.points;
    const xs = points.map((point) => point[0]);
    const ys = points.map((point) => point[1]);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const width = Math.max(0.001, Math.max(...xs) - minX);
    const height = Math.max(0.001, Math.max(...ys) - minY);
    const pad = Math.max(0.75, Math.max(width, height) * 0.14);
    const vbW = width + pad * 2;
    const vbH = height + pad * 2;
    const dx = minX - pad;
    const dy = minY - pad;
    const start = points[0];
    const end = points[points.length - 1];
    const dot = Math.max(vbW, vbH) / 95;
    const pointString = points
      .map((point) => `${Number(point[0].toFixed(3))},${Number(point[1].toFixed(3))}`)
      .join(' ');

    svg.setAttribute('viewBox', `${dx} ${dy} ${vbW} ${vbH}`);
    let markup = `<polyline class="survey-path" points="${pointString}" fill="none" vector-effect="non-scaling-stroke"/>`;
    if (!form.closeLoop && result.gap > 0.01) {
      markup += `<line class="survey-gap-line" x1="${end[0]}" y1="${end[1]}" x2="${start[0]}" y2="${start[1]}" vector-effect="non-scaling-stroke"/>`;
    }
    markup += `<circle class="survey-origin" cx="${start[0]}" cy="${start[1]}" r="${dot}"/>`;
    markup += `<circle class="survey-end" cx="${end[0]}" cy="${end[1]}" r="${dot}"/>`;
    svg.innerHTML = markup;
  };

  const updateSurveyPreview = () => {
    const svg = $('#surveyPreviewSvg');
    const message = $('#surveyMessage');
    const insert = $('#surveyInsert');
    if (!svg || !message || !insert) return null;

    const form = readSurveyForm();
    message.textContent = '';
    message.className = 'survey-message';
    const parsed = parseSurveyText($('#surveyInput').value);
    if (parsed.error) {
      svg.innerHTML = '';
      svg.removeAttribute('viewBox');
      message.textContent = parsed.error;
      message.classList.add('is-error');
      insert.disabled = true;
      setSurveyStats(null, 0);
      return null;
    }

    if (parsed.warning) {
      message.textContent = parsed.warning;
      message.classList.add('is-warn');
    }
    const result = buildSurvey(parsed.segments, form);
    insert.disabled = false;
    renderSurveyPreview(result, form);
    setSurveyStats(result, parsed.segments.length);
    return { parsed, result, form };
  };

  const openSurvey = (prefill = '') => {
    const dialog = $('#surveyDialog');
    if (!dialog) return;
    closeDrawers();
    hideTouchActions();
    if (prefill) $('#surveyInput').value = prefill;
    updateSurveyPreview();
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    setTimeout(() => $('#surveyInput').focus(), 30);
  };

  const insertSurveyOutline = () => {
    const view = updateSurveyPreview();
    if (!view) return false;
    if (!ensureLayerUsable()) return false;
    const { parsed, result, form } = view;
    const points = result.points.map((point) => [point[0], point[1]]);
    if (form.closeLoop && result.gap > 0.0001) points.push([...points[0]]);

    const entity = applyNewStyle({
      type: 'polyline',
      points,
      closed: form.closeLoop
    });
    const surveyNumber = state.doc.entities.filter((e) => /^Surveyed outline/i.test(e.name || '')).length + 1;
    entity.name = `Surveyed outline ${surveyNumber}`;
    state.doc.entities.push(entity);
    setSelection([entity.id], false);
    commit('Insert survey outline');
    renderLayers();
    updateInspector();
    updateStatus();
    fitToContent();
    toast('Survey outline inserted', `${parsed.segments.length} segments · ${result.total.toFixed(1)} m perimeter.`);
    return true;
  };

  const COMMANDS = [
    { command: 'SELECT', hint: 'Selection tool', run: () => setTool('select') },
    { command: 'PAN', hint: 'Pan the drawing sheet', run: () => setTool('pan') },
    { command: 'LINE', hint: 'Chained line segments', run: () => setTool('line') },
    { command: 'POLYLINE', hint: 'Connected path', run: () => setTool('polyline') },
    { command: 'RECT', hint: 'Rectangle from two corners', run: () => setTool('rect') },
    { command: 'CIRCLE', hint: 'Circle from centre and radius', run: () => setTool('circle') },
    { command: 'ELLIPSE', hint: 'Ellipse from a bounding box', run: () => setTool('ellipse') },
    { command: 'POLYGON', hint: 'Regular polygon', run: () => setTool('polygon') },
    { command: 'ARC', hint: 'Three-point arc', run: () => setTool('arc') },
    { command: 'WALL', hint: 'Wall chain with thickness', run: () => setTool('wall') },
    { command: 'TEXT', hint: 'Place a map annotation', run: () => setTool('text') },
    { command: 'MARKER', hint: 'Stamp a trail prop', run: (args) => { if (!chooseMarker(args)) { setTool('marker'); if (args) toast('Marker not found', `“${args}” is not a known prop.`, 'warn'); } } },
    { command: 'MEASURE', hint: 'Dimension between two points', run: () => setTool('measure') },
    { command: 'SURVEY', hint: 'Build an outline from distances and turns', run: (args) => openSurvey(args) },
    { command: 'PRESET', hint: 'Insert a structure preset', run: (args) => {
      const preset = findPreset(args);
      if (preset) insertPreset(preset);
      else toast('Preset not found', 'Try: PRESET SHACK, PRESET HARVESTER, PRESET GATE.', 'warn');
    } },
    { command: 'INSERT', hint: 'Insert a structure preset', run: (args) => {
      const preset = findPreset(args);
      if (preset) insertPreset(preset);
      else toast('Preset not found', 'Try: INSERT MAIN BUILDING or INSERT JUNGLE GYM.', 'warn');
    } },
    { command: 'ZOOM FIT', hint: 'Fit all geometry to the view', run: () => fitToContent() },
    { command: 'ZOOM IN', hint: 'Zoom in at the centre', run: () => zoomBy(1.25) },
    { command: 'ZOOM OUT', hint: 'Zoom out at the centre', run: () => zoomBy(0.8) },
    { command: 'FIT', hint: 'Fit all geometry to the view', run: () => fitToContent() },
    { command: 'GRID ON', hint: 'Show the drafting grid', run: () => { state.doc.showGrid = true; commit('Show grid'); updateStatus(); updateInspector(); } },
    { command: 'GRID OFF', hint: 'Hide the drafting grid', run: () => { state.doc.showGrid = false; commit('Hide grid'); updateStatus(); updateInspector(); } },
    { command: 'SNAP ON', hint: 'Enable grid and point snapping', run: () => { state.doc.snapGrid = true; state.doc.snapGeom = true; commit('Enable snapping'); updateStatus(); updateInspector(); } },
    { command: 'SNAP OFF', hint: 'Disable grid and point snapping', run: () => { state.doc.snapGrid = false; state.doc.snapGeom = false; commit('Disable snapping'); updateStatus(); updateInspector(); } },
    { command: 'ORTHO ON', hint: 'Constrain drawing to 0° / 90°', run: () => { state.doc.ortho = true; commit('Enable ortho'); updateStatus(); updateInspector(); } },
    { command: 'ORTHO OFF', hint: 'Free-angle drawing', run: () => { state.doc.ortho = false; commit('Disable ortho'); updateStatus(); updateInspector(); } },
    { command: 'UNDO', hint: 'Undo the last change', run: () => undo() },
    { command: 'REDO', hint: 'Redo the last change', run: () => redo() },
    { command: 'DUPLICATE', hint: 'Duplicate the selection', run: () => duplicateSelection() },
    { command: 'DELETE', hint: 'Delete the selection', run: () => deleteSelection() },
    { command: 'GROUP', hint: 'Group the selection', run: () => groupSelection() },
    { command: 'UNGROUP', hint: 'Ungroup the selection', run: () => ungroupSelection() },
    { command: 'SELECT ALL', hint: 'Select every visible object', run: () => selectAll() },
    { command: 'SAVE', hint: 'Download a JSON map copy', run: () => saveCopy() },
    { command: 'EXPORT PNG', hint: 'Download a blueprint sheet', run: () => exportPNG() },
    { command: 'EXPORT SVG', hint: 'Download vector line work', run: () => exportSVG() },
    { command: 'EXPORT JSON', hint: 'Download the editable map', run: () => saveCopy() },
    { command: 'CLEAR', hint: 'Clear all geometry from this sheet', run: () => clearMap() },
    { command: 'NEW', hint: 'Start a blank trial ground', run: () => newMap() },
    { command: 'HELP', hint: 'Open the field manual', run: () => openHelp() },
    { command: 'CENTER', hint: 'Fit the drawing to the view', run: () => fitToContent() }
  ];

  const commandHints = () => COMMANDS.map((item) => `${item.command} — ${item.hint}`);

  const closeCommandSuggest = () => {
    const box = $('#commandSuggest');
    box.classList.remove('open');
    box.innerHTML = '';
    state.commandIndex = -1;
  };

  const renderCommandSuggest = (value) => {
    const box = $('#commandSuggest');
    const query = String(value || '').trim().toUpperCase();
    if (!query) {
      closeCommandSuggest();
      return;
    }
    const matches = COMMANDS.filter((item) => item.command.startsWith(query) || item.command.includes(query)).slice(0, 7);
    const presetMatches = PRESETS
      .filter((p) => p.name.toUpperCase().includes(query) || p.id.toUpperCase().includes(query))
      .slice(0, 3)
      .map((p) => ({ command: `PRESET ${p.name.toUpperCase()}`, hint: p.tag }));
    const rows = [...matches, ...presetMatches].slice(0, 8);
    if (!rows.length) {
      closeCommandSuggest();
      return;
    }
    box.innerHTML = rows.map((row, index) => `
      <button class="suggest-row ${index === 0 ? 'active' : ''}" data-command="${escapeHTML(row.command)}">
        <span>${escapeHTML(row.command)}</span><small>${escapeHTML(row.hint)}</small>
      </button>
    `).join('');
    box.classList.add('open');
    state.commandIndex = 0;
  };

  const executeCommand = (raw) => {
    const text = String(raw || '').trim();
    if (!text) return;
    const upper = text.toUpperCase();
    const direct = COMMANDS.find((item) => item.command === upper);
    if (direct) {
      direct.run('');
      return true;
    }
    const [head, ...rest] = text.split(/\s+/);
    const command = head.toUpperCase();
    const args = rest.join(' ');
    const matches = COMMANDS
      .filter((item) => item.command.split(' ')[0] === command)
      .sort((a, b) => b.command.length - a.command.length);
    const special = matches.find((item) => upper.startsWith(item.command));
    if (special) {
      special.run(upper.slice(special.command.length).trim());
      return true;
    }

    if (command === 'MARKER' || command === 'PROP') {
      const q = args.toLowerCase();
      const entry = Object.entries(MARKERS).find(([key, marker]) => key === q || marker.name.toLowerCase() === q)
        || Object.entries(MARKERS).find(([key, marker]) => key.includes(q) || marker.name.toLowerCase().includes(q));
      if (entry) {
        state.activeMarker = entry[0];
        setTool('marker');
        renderProps();
        return true;
      }
    }
    if (command === 'ZOOM') {
      const value = parseFloat(args);
      if (Number.isFinite(value) && value > 0) {
        const target = clamp(BASE_ZOOM * (value / 100), 2, 80);
        state.camera.zoom = target;
        state.camera.x = state.view.w / 2;
        state.camera.y = state.view.h / 2;
        fitToContent();
        return true;
      }
      fitToContent();
      return true;
    }
    if (command === 'GRID') {
      const size = parseFloat(args);
      if (Number.isFinite(size) && size > 0) {
        state.doc.gridSize = clamp(size, 0.1, 10);
        commit('Change grid size');
        updateStatus();
        updateInspector();
        return true;
      }
      state.doc.showGrid = !state.doc.showGrid;
      commit('Toggle grid');
      updateStatus();
      updateInspector();
      return true;
    }
    if (command === 'SNAP' || command === 'POINTS') {
      state.doc.snapGeom = !state.doc.snapGeom;
      commit('Toggle point snapping');
      updateStatus();
      updateInspector();
      return true;
    }
    if (command === 'ORTHO') {
      state.doc.ortho = !state.doc.ortho;
      commit('Toggle ortho');
      updateStatus();
      updateInspector();
      return true;
    }
    if (command === 'LAYER') {
      const q = args.toLowerCase();
      const layer = state.doc.layers.find((l) => l.id.toLowerCase() === q || l.name.toLowerCase() === q)
        || state.doc.layers.find((l) => l.id.toLowerCase().includes(q) || l.name.toLowerCase().includes(q));
      if (layer) {
        if (layer.locked) {
          toast('Layer locked', `${layer.name} is locked. Unlock it before drawing.`, 'warn');
          return true;
        }
        state.activeLayer = layer.id;
        renderLayers();
        updateStatus();
        toast('Active layer', layer.name);
        return true;
      }
    }
    if (command === 'PRESET' || command === 'INSERT' || command === 'PLACE') {
      const preset = findPreset(args);
      if (preset) insertPreset(preset);
      else toast('Preset not found', 'Try SHACK, MAIN BUILDING, HARVESTER or GATE.', 'warn');
      return true;
    }
    if (command === 'MARKER') {
      setTool('marker');
      return true;
    }

    const preset = findPreset(text);
    if (preset) {
      insertPreset(preset);
      return true;
    }
    const toolEntry = Object.entries(TOOLS).find(([, meta]) => meta.name.toUpperCase() === upper);
    if (toolEntry) {
      setTool(toolEntry[0]);
      return true;
    }
    toast('Unknown command', `“${text}” is not in the command index.`, 'warn');
    return false;
  };

  const submitCommand = () => {
    const input = $('#commandInput');
    const value = input.value;
    if (!value.trim()) return;
    executeCommand(value);
    input.value = '';
    closeCommandSuggest();
  };

  // ── Selection actions ────────────────────────────────────────────────────

  const duplicateSelection = () => {
    const selected = selectedEntities();
    if (!selected.length) {
      toast('Nothing selected', 'Select one or more objects to duplicate.', 'warn');
      return;
    }
    const groupMap = new Map();
    const step = Math.max(0.5, state.doc.gridSize || 1);
    const clones = selected.map((source) => {
      const clone = deepClone(source);
      clone.id = uid('e');
      if (clone.groupId) {
        if (!groupMap.has(clone.groupId)) groupMap.set(clone.groupId, uid('g'));
        clone.groupId = groupMap.get(clone.groupId);
      }
      translateEntity(clone, step, step);
      return clone;
    });
    state.doc.entities.push(...clones);
    setSelection(clones.map((e) => e.id), false);
    commit('Duplicate selection');
    renderLayers();
    updateInspector();
    updateStatus();
    scheduleDraw();
    toast('Duplicated', `${clones.length} object${clones.length === 1 ? '' : 's'} copied.`);
  };

  const deleteSelection = () => {
    const ids = new Set(state.selection);
    if (!ids.size) return;
    state.doc.entities = state.doc.entities.filter((e) => !ids.has(e.id));
    state.selection.clear();
    state.drag = null;
    state.marquee = null;
    commit('Delete selection');
    renderLayers();
    updateInspector();
    updateStatus();
    updatePrompt();
    scheduleDraw();
  };

  const groupSelection = () => {
    const selected = selectedEntities();
    if (selected.length < 2) {
      toast('Group needs two objects', 'Shift-click or marquee-select at least two objects.', 'warn');
      return;
    }
    const gid = uid('g');
    const name = `Group ${state.doc.entities.filter((e) => e.groupId).length + 1}`;
    selected.forEach((e) => {
      e.groupId = gid;
      e.groupName = name;
    });
    commit('Group selection');
    renderLayers();
    updateInspector();
    scheduleDraw();
    toast('Grouped', `${selected.length} objects joined as ${name}.`);
  };

  const ungroupSelection = () => {
    const selected = selectedEntities();
    if (!selected.length) return;
    const ids = new Set(selected.map((e) => e.groupId).filter(Boolean));
    if (!ids.size) {
      toast('No group to break', 'The selection is not part of a group.', 'warn');
      return;
    }
    state.doc.entities.forEach((e) => {
      if (ids.has(e.groupId)) {
        delete e.groupId;
        delete e.groupName;
      }
    });
    commit('Ungroup selection');
    renderLayers();
    updateInspector();
    scheduleDraw();
    toast('Ungrouped', 'Objects can now be edited independently.');
  };

  const bringSelectionFront = () => {
    const ids = new Set(state.selection);
    if (!ids.size) return;
    const moving = state.doc.entities.filter((e) => ids.has(e.id));
    state.doc.entities = state.doc.entities.filter((e) => !ids.has(e.id)).concat(moving);
    commit('Bring to front');
    renderLayers();
    scheduleDraw();
  };

  const alignSelection = (mode) => {
    const selected = selectedEntities();
    if (selected.length < 2) return;
    const bounds = unionBounds(selected);
    if (!bounds) return;
    selected.forEach((e) => {
      const b = getEntityBounds(e);
      if (!b) return;
      let dx = 0;
      let dy = 0;
      if (mode === 'left') dx = bounds.x - b.x;
      if (mode === 'right') dx = (bounds.x + bounds.w) - (b.x + b.w);
      if (mode === 'center-h') dx = (bounds.x + bounds.w / 2) - (b.x + b.w / 2);
      if (mode === 'top') dy = bounds.y - b.y;
      if (mode === 'bottom') dy = (bounds.y + bounds.h) - (b.y + b.h);
      if (mode === 'center-v') dy = (bounds.y + bounds.h / 2) - (b.y + b.h / 2);
      translateEntity(e, dx, dy);
    });
    commit(`Align ${mode}`);
    updateInspector();
    scheduleDraw();
  };

  const flipEntity = (e, axis, center) => {
    const mirror = (x, y) => axis === 'h'
      ? [2 * center.x - x, y]
      : [x, 2 * center.y - y];
    if (PATH_TYPES.has(e.type) || e.type === 'arc' || e.type === 'measure') {
      e.points = (e.points || []).map((p) => mirror(p[0], p[1]));
    } else if (e.type === 'rect') {
      if (axis === 'h') {
        const nx = 2 * center.x - (e.x + e.w);
        e.x = nx;
      } else {
        const ny = 2 * center.y - (e.y + e.h);
        e.y = ny;
      }
    } else if (e.type === 'circle' || e.type === 'ellipse' || e.type === 'polygon') {
      const c = mirror(e.cx, e.cy);
      e.cx = c[0];
      e.cy = c[1];
    } else if (e.type === 'text' || e.type === 'marker') {
      const c = mirror(e.x, e.y);
      e.x = c[0];
      e.y = c[1];
    }
    if (e.type !== 'circle') e.rotation = normalizeAngle(-(e.rotation || 0));
  };

  const flipSelection = (axis) => {
    const selected = selectedEntities();
    if (!selected.length) return;
    const bounds = unionBounds(selected);
    if (!bounds) return;
    const center = { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
    selected.forEach((e) => flipEntity(e, axis, center));
    commit(axis === 'h' ? 'Flip selection horizontally' : 'Flip selection vertically');
    updateInspector();
    scheduleDraw();
  };

  const nudgeSelection = (dx, dy) => {
    const selected = selectedEntities();
    if (!selected.length) return;
    selected.forEach((e) => translateEntity(e, dx, dy));
    commit('Nudge selection');
    updateInspector();
    scheduleDraw();
  };

  const clearMap = () => {
    if (!state.doc.entities.length) return;
    if (!window.confirm('Clear every object from this sheet? This can still be undone.')) return;
    state.doc.entities = [];
    state.selection.clear();
    state.draft = null;
    state.drag = null;
    commit('Clear map');
    renderLayers();
    updateInspector();
    updateStatus();
    updatePrompt();
    scheduleDraw();
    toast('Sheet cleared', 'The map outline has been removed.');
  };

  const alignSelectionAction = (action) => {
    const map = {
      'align-left': 'left', 'align-center-h': 'center-h', 'align-right': 'right',
      'align-top': 'top', 'align-center-v': 'center-v', 'align-bottom': 'bottom'
    };
    if (map[action]) alignSelection(map[action]);
  };

  // ── Underlay ─────────────────────────────────────────────────────────────

  const loadUnderlayImage = () => {
    const image = state.doc?.image;
    if (!image?.dataUrl) {
      underlayImage = null;
      underlaySrc = '';
      return;
    }
    if (underlaySrc === image.dataUrl && underlayImage) return;
    underlaySrc = image.dataUrl;
    const img = new Image();
    img.onload = () => {
      underlayImage = img;
      scheduleDraw();
    };
    img.onerror = () => {
      underlayImage = null;
      toast('Reference image unavailable', 'The underlay could not be decoded.', 'error');
    };
    img.src = underlaySrc;
  };

  const importUnderlayFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const src = String(reader.result || '');
      const img = new Image();
      img.onload = () => {
        const aspect = img.naturalWidth / Math.max(1, img.naturalHeight);
        const width = 42;
        const height = width / Math.max(0.05, aspect);
        const center = screenToWorld(state.view.w / 2, (state.view.h - 56) / 2);
        state.doc.image = {
          dataUrl: src,
          name: file.name,
          x: center.x - width / 2,
          y: center.y - height / 2,
          w: width,
          h: height,
          opacity: 0.42,
          visible: true
        };
        underlaySrc = src;
        underlayImage = img;
        commit('Import reference image');
        updateInspector();
        scheduleDraw();
        toast('Reference image added', `${file.name} · adjust opacity in the inspector.`);
      };
      img.onerror = () => toast('Image import failed', 'That file could not be decoded as an image.', 'error');
      img.src = src;
    };
    reader.readAsDataURL(file);
  };

  const fitUnderlay = () => {
    const image = state.doc?.image;
    if (!image) return;
    const aspect = underlayImage
      ? underlayImage.naturalWidth / Math.max(1, underlayImage.naturalHeight)
      : (image.w / Math.max(0.01, image.h));
    const bounds = unionBounds(state.doc.entities);
    const width = bounds ? Math.max(8, bounds.w * 1.08) : 42;
    const height = width / Math.max(0.05, aspect);
    const center = bounds
      ? { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 }
      : screenToWorld(state.view.w / 2, (state.view.h - 56) / 2);
    image.x = center.x - width / 2;
    image.y = center.y - height / 2;
    image.w = width;
    image.h = height;
    commit('Fit reference image');
    updateInspector();
    scheduleDraw();
  };

  const removeUnderlay = () => {
    if (!state.doc?.image) return;
    state.doc.image = null;
    underlayImage = null;
    underlaySrc = '';
    commit('Remove reference image');
    updateInspector();
    scheduleDraw();
  };

  // ── Inspector events ─────────────────────────────────────────────────────

  const NUMERIC_PROPS = new Set([
    'x', 'y', 'w', 'h', 'cx', 'cy', 'r', 'rx', 'ry', 'sides',
    'fontSize', 'size', 'thickness', 'strokeWidth', 'rotation'
  ]);

  const setEntityProperty = (entity, prop, value, isRange = false) => {
    if (!entity) return false;
    if (prop === 'opacityRange') {
      entity.opacity = clamp(Number(value) / 100, 0.05, 1);
      return false;
    }
    if (prop === 'color') {
      entity.color = value;
      return false;
    }
    if (prop.endsWith('Hex')) {
      const key = prop.slice(0, -3);
      const clean = String(value).trim();
      if (/^#[0-9a-f]{6}$/i.test(clean)) {
        entity[key] = clean;
        return false;
      }
      return false;
    }
    if (prop === 'name' || prop === 'text') {
      entity[prop] = value;
      return prop === 'name';
    }
    if (prop === 'layer' || prop === 'markerType' || prop === 'dash') {
      entity[prop] = value;
      if (prop === 'markerType' && MARKERS[value]) entity.color = MARKERS[value].color;
      return true;
    }
    if (prop === 'gcx' || prop === 'gcy' || prop === 'bx' || prop === 'by') return false;
    if (NUMERIC_PROPS.has(prop)) {
      let number = parseFloat(value);
      if (!Number.isFinite(number)) return false;
      if (['w', 'h', 'r', 'rx', 'ry'].includes(prop)) number = Math.max(0.01, Math.abs(number));
      if (prop === 'sides') number = clamp(Math.round(number), 3, 16);
      if (prop === 'rotation') number = normalizeAngle(number);
      if (prop === 'strokeWidth' || prop === 'thickness') number = Math.max(0.01, number);
      entity[prop] = number;
      return true;
    }
    return false;
  };

  const handleInspectorInput = (event, committed) => {
    const target = event.target;
    if (!state.doc) return;

    if (target.matches('[data-map-name]')) {
      state.doc.name = target.value;
      updateTopbar();
      if (committed) commit('Rename map');
      return;
    }
    if (target.matches('[data-map-realm]') && committed) {
      state.doc.realm = target.value;
      updateTopbar();
      commit('Change realm');
      return;
    }
    if (target.matches('[data-map-grid]') && committed) {
      state.doc.gridSize = Number(target.value) || 1;
      commit('Change grid size');
      updateStatus();
      scheduleDraw();
      return;
    }
    if (target.matches('[data-underlay-opacity]')) {
      if (!state.doc.image) return;
      state.doc.image.opacity = clamp(Number(target.value) / 100, 0.05, 1);
      const value = target.closest('.range-row')?.querySelector('.range-value');
      if (value) value.textContent = `${Math.round(state.doc.image.opacity * 100)}%`;
      scheduleDraw();
      if (committed) commit('Adjust reference opacity');
      return;
    }

    const entity = selectedEntities();
    if (entity.length !== 1) return;
    const prop = target.dataset.prop;
    if (!prop) return;
    const changedStructure = setEntityProperty(entity[0], prop, target.value, target.type === 'range');

    if (prop === 'color') {
      const hex = target.closest('.color-field')?.querySelector('[data-prop$="Hex"]');
      if (hex) hex.value = target.value;
    }
    if (prop.endsWith('Hex')) {
      if (/^#[0-9a-f]{6}$/i.test(target.value.trim())) {
        const picker = target.closest('.color-field')?.querySelector('input[type="color"]');
        if (picker) picker.value = target.value.trim();
      }
    }
    if (prop === 'opacityRange') {
      const value = target.closest('.range-row')?.querySelector('.range-value');
      if (value) value.textContent = `${Math.round((entity[0].opacity ?? 1) * 100)}%`;
    }
    scheduleDraw();
    updateStatus();
    if (committed) {
      commit(`Edit ${prop}`);
      if (changedStructure) {
        renderLayers();
        updateInspector();
      }
    }
  };

  const runAction = (action) => {
    const selected = selectedEntities();
    switch (action) {
      case 'fit-view': fitToContent(); break;
      case 'download-json': saveCopy(); break;
      case 'export-png': exportPNG(); break;
      case 'clear-map': clearMap(); break;
      case 'import-underlay': $('#fileImageInput').click(); break;
      case 'fit-underlay': fitUnderlay(); break;
      case 'remove-underlay': removeUnderlay(); break;
      case 'toggle-show-grid':
        state.doc.showGrid = !state.doc.showGrid;
        commit('Toggle grid'); updateInspector(); updateStatus(); scheduleDraw(); break;
      case 'toggle-snap-grid':
        state.doc.snapGrid = !state.doc.snapGrid;
        commit('Toggle grid snap'); updateInspector(); updateStatus(); break;
      case 'toggle-snap-geom':
        state.doc.snapGeom = !state.doc.snapGeom;
        commit('Toggle point snap'); updateInspector(); updateStatus(); break;
      case 'toggle-ortho':
        state.doc.ortho = !state.doc.ortho;
        commit('Toggle ortho'); updateInspector(); updateStatus(); break;
      case 'toggle-filled':
        if (selected.length === 1) {
          selected[0].filled = !selected[0].filled;
          commit('Toggle fill'); updateInspector(); scheduleDraw();
        }
        break;
      case 'toggle-closed':
        if (selected.length === 1) {
          selected[0].closed = !selected[0].closed;
          commit('Toggle closed path'); updateInspector(); scheduleDraw();
        }
        break;
      case 'duplicate': duplicateSelection(); break;
      case 'delete': deleteSelection(); break;
      case 'group': groupSelection(); break;
      case 'ungroup': ungroupSelection(); break;
      case 'bring-front': bringSelectionFront(); break;
      case 'flip-h': flipSelection('h'); break;
      case 'flip-v': flipSelection('v'); break;
      default:
        alignSelectionAction(action);
    }
  };

  const bindInspectorEvents = () => {
    const body = $('#inspectorBody');
    body.addEventListener('input', (event) => handleInspectorInput(event, false));
    body.addEventListener('change', (event) => handleInspectorInput(event, true));
    body.addEventListener('click', (event) => {
      const actionButton = event.target.closest('[data-action]');
      if (!actionButton || !body.contains(actionButton)) return;
      event.preventDefault();
      runAction(actionButton.dataset.action);
    });
  };

  // ── Export: SVG & PNG ────────────────────────────────────────────────────

  const svgSafe = (value) => escapeHTML(value).replace(/"/g, '&quot;');
  const svgColor = (value, fallback = '#c5b49d') => (
    /^#[0-9a-f]{3,8}$/i.test(String(value || '')) ? String(value) : fallback
  );

  const svgDashArray = (e) => {
    if (e.dash === 'dashed') {
      const w = Math.max(0.06, e.strokeWidth || 0.1);
      return ` stroke-dasharray="${formatNum(w * 4, 3)} ${formatNum(w * 2.4, 3)}"`;
    }
    if (e.dash === 'dotted') {
      const w = Math.max(0.05, e.strokeWidth || 0.08);
      return ` stroke-dasharray="${formatNum(w * 0.7, 3)} ${formatNum(w * 1.8, 3)}" stroke-linecap="round"`;
    }
    return '';
  };

  const markerSVGGlyph = (type) => {
    const paths = {
      pallet: '<path d="M-.22-.2v.4M-.08-.2v.4M.08-.2v.4M.22-.2v.4"/>',
      vault: '<path d="M-.16-.26v.52M.16-.26v.52M-.16 0h.32"/>',
      generator: '<rect x="-.18" y="-.16" width=".36" height=".32"/><path d="M.03-.12-.08.02h.12L-.04.16"/>',
      hook: '<path d="M0-.26v.3a.12.12 0 0 0 .24 0"/>',
      totem: '<path d="m0-.26.2.13-.06.26h-.28L-.2-.13Z"/>',
      chest: '<rect x="-.2" y="-.13" width=".4" height=".26"/><path d="M-.2-.13-.1-.25h.2l.1.12M-.2 0h.4"/>',
      hatch: '<path d="m0-.22.22.22L0 .22l-.22-.22Z"/><path d="m0-.11.11.11L0 .11-.11 0Z"/>',
      gate: '<path d="M-.24-.22v.44M.24-.22v.44M-.24 0h.48M-.1-.22v.44M.1-.22v.44"/>',
      basement: '<rect x="-.2" y="-.2" width=".4" height=".4"/><path d="m-.12.12.24-.24M-.12 0l.12-.12M0 .12l.12-.12"/>',
      stairs: '<path d="M-.22.2h.11V.09h.11V-.02h.11v-.11h.11"/>',
      locker: '<rect x="-.15" y="-.24" width=".3" height=".48"/><path d="M-.15 0h.3"/>'
    };
    return paths[type] || '<circle r=".18"/>';
  };

  const svgEntity = (e) => {
    const stroke = svgColor(e.stroke || layerById(e.layer)?.color, '#c5b49d');
    const opacity = clamp(Number(e.opacity ?? 1), 0.02, 1);
    const sw = Math.max(0.04, Number(e.strokeWidth) || 0.1);
    const common = `fill="none" stroke="${stroke}" stroke-width="${formatNum(sw, 3)}" stroke-opacity="${formatNum(opacity, 2)}"${svgDashArray(e)}`;
    if (PATH_TYPES.has(e.type)) {
      const pts = (e.points || []).map((p) => `${formatNum(p[0], 3)},${formatNum(p[1], 3)}`).join(' ');
      if (!pts) return '';
      if (e.type === 'wall') {
        const wallPts = e.closed ? `${pts} ${formatNum(e.points[0][0], 3)},${formatNum(e.points[0][1], 3)}` : pts;
        return `<polyline points="${wallPts}" fill="none" stroke="${stroke}" stroke-width="${formatNum(Math.max(0.18, e.thickness || 0.3), 3)}" stroke-opacity="${formatNum(opacity, 2)}" stroke-linecap="round" stroke-linejoin="round"${svgDashArray(e)}/>`;
      }
      const fill = e.filled ? `fill="${svgColor(e.fill, stroke)}" fill-opacity="${formatNum(Math.min(0.65, opacity * 0.62), 2)}"` : 'fill="none"';
      return `<polyline points="${e.closed ? `${pts} ${formatNum(e.points[0][0], 3)},${formatNum(e.points[0][1], 3)}` : pts}" ${fill} stroke="${stroke}" stroke-width="${formatNum(sw, 3)}" stroke-opacity="${formatNum(opacity, 2)}" stroke-linejoin="round"${svgDashArray(e)}/>`;
    }
    if (e.type === 'rect') {
      const cx = e.x + e.w / 2;
      const cy = e.y + e.h / 2;
      const transform = e.rotation ? ` transform="rotate(${formatNum(e.rotation, 3)} ${formatNum(cx, 3)} ${formatNum(cy, 3)})"` : '';
      const fill = e.filled ? `fill="${svgColor(e.fill, stroke)}" fill-opacity="${formatNum(Math.min(0.65, opacity * 0.58), 2)}"` : 'fill="none"';
      return `<rect x="${formatNum(e.x, 3)}" y="${formatNum(e.y, 3)}" width="${formatNum(e.w, 3)}" height="${formatNum(e.h, 3)}"${transform} ${fill} stroke="${stroke}" stroke-width="${formatNum(sw, 3)}" stroke-opacity="${formatNum(opacity, 2)}"${svgDashArray(e)}/>`;
    }
    if (e.type === 'circle') {
      const fill = e.filled ? `fill="${svgColor(e.fill, stroke)}" fill-opacity="${formatNum(Math.min(0.65, opacity * 0.58), 2)}"` : 'fill="none"';
      return `<circle cx="${formatNum(e.cx, 3)}" cy="${formatNum(e.cy, 3)}" r="${formatNum(e.r, 3)}" ${fill} stroke="${stroke}" stroke-width="${formatNum(sw, 3)}" stroke-opacity="${formatNum(opacity, 2)}"${svgDashArray(e)}/>`;
    }
    if (e.type === 'ellipse') {
      const fill = e.filled ? `fill="${svgColor(e.fill, stroke)}" fill-opacity="${formatNum(Math.min(0.65, opacity * 0.58), 2)}"` : 'fill="none"';
      return `<ellipse cx="${formatNum(e.cx, 3)}" cy="${formatNum(e.cy, 3)}" rx="${formatNum(e.rx, 3)}" ry="${formatNum(e.ry, 3)}" transform="rotate(${formatNum(e.rotation || 0, 3)} ${formatNum(e.cx, 3)} ${formatNum(e.cy, 3)})" ${fill} stroke="${stroke}" stroke-width="${formatNum(sw, 3)}" stroke-opacity="${formatNum(opacity, 2)}"${svgDashArray(e)}/>`;
    }
    if (e.type === 'polygon') {
      const pts = polygonPoints(e).map((p) => `${formatNum(p[0], 3)},${formatNum(p[1], 3)}`).join(' ');
      const fill = e.filled ? `fill="${svgColor(e.fill, stroke)}" fill-opacity="${formatNum(Math.min(0.65, opacity * 0.58), 2)}"` : 'fill="none"';
      return `<polygon points="${pts}" ${fill} stroke="${stroke}" stroke-width="${formatNum(sw, 3)}" stroke-opacity="${formatNum(opacity, 2)}"${svgDashArray(e)}/>`;
    }
    if (e.type === 'arc') {
      const g = arcGeometry(e);
      if (!g) return '';
      const start = [g.cx + Math.cos(g.a0) * g.r, g.cy + Math.sin(g.a0) * g.r];
      const end = [g.cx + Math.cos(g.a1) * g.r, g.cy + Math.sin(g.a1) * g.r];
      const sweep = g.forward ? normalizeRad(g.a1 - g.a0) : normalizeRad(g.a0 - g.a1);
      return `<path d="M ${formatNum(start[0], 3)} ${formatNum(start[1], 3)} A ${formatNum(g.r, 3)} ${formatNum(g.r, 3)} 0 ${sweep > Math.PI ? 1 : 0} ${g.forward ? 1 : 0} ${formatNum(end[0], 3)} ${formatNum(end[1], 3)}" fill="none" stroke="${stroke}" stroke-width="${formatNum(sw, 3)}" stroke-opacity="${formatNum(opacity, 2)}"${svgDashArray(e)}/>`;
    }
    if (e.type === 'marker') {
      const color = svgColor(e.color || MARKERS[e.markerType]?.color, '#7ed8cf');
      const size = Math.max(0.2, e.size || 1.8);
      return `<g transform="translate(${formatNum(e.x, 3)} ${formatNum(e.y, 3)}) rotate(${formatNum(e.rotation || 0, 3)}) scale(${formatNum(size, 3)})" fill="none" stroke="${color}" stroke-opacity="${formatNum(opacity, 2)}" stroke-width="${formatNum(0.075, 3)}" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="0" cy="0" r=".44" fill="${color}" fill-opacity="${formatNum(0.09 * opacity, 3)}"/>
        <circle cx="0" cy="0" r=".44" stroke-opacity="${formatNum(0.46 * opacity, 2)}"/>
        ${markerSVGGlyph(e.markerType)}
      </g>`;
    }
    if (e.type === 'text') {
      const fill = svgColor(e.color, '#b9b3a6');
      const lines = String(e.text || '').split('\n');
      const lineHeight = (e.fontSize || 0.9) * 1.12;
      const startY = -((lines.length - 1) * lineHeight) / 2;
      const transform = e.rotation
        ? ` transform="rotate(${formatNum(e.rotation, 3)} ${formatNum(e.x, 3)} ${formatNum(e.y, 3)})"`
        : '';
      const tspans = lines.map((line, index) => `<tspan x="0" dy="${index === 0 ? formatNum(startY, 3) : formatNum(lineHeight, 3)}">${escapeHTML(line)}</tspan>`).join('');
      return `<text x="${formatNum(e.x, 3)}" y="${formatNum(e.y, 3)}"${transform} fill="${fill}" fill-opacity="${formatNum(opacity, 2)}" font-family="'Arial Narrow', Arial, sans-serif" font-size="${formatNum(e.fontSize || 0.9, 3)}" text-anchor="middle" dominant-baseline="middle" letter-spacing=".04">${tspans || '<tspan> </tspan>'}</text>`;
    }
    if (e.type === 'measure') {
      const [a, b] = e.points || [];
      if (!a || !b) return '';
      const color = svgColor(e.stroke, '#7ed8cf');
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const nx = Math.cos(angle + Math.PI / 2);
      const ny = Math.sin(angle + Math.PI / 2);
      const tick = 0.24;
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      return `<g opacity="${formatNum(opacity, 2)}">
        <line x1="${formatNum(a[0], 3)}" y1="${formatNum(a[1], 3)}" x2="${formatNum(b[0], 3)}" y2="${formatNum(b[1], 3)}" stroke="${color}" stroke-width=".07" stroke-dasharray=".42 .3"/>
        <line x1="${formatNum(a[0] - nx * tick, 3)}" y1="${formatNum(a[1] - ny * tick, 3)}" x2="${formatNum(a[0] + nx * tick, 3)}" y2="${formatNum(a[1] + ny * tick, 3)}" stroke="${color}" stroke-width=".07"/>
        <line x1="${formatNum(b[0] - nx * tick, 3)}" y1="${formatNum(b[1] - ny * tick, 3)}" x2="${formatNum(b[0] + nx * tick, 3)}" y2="${formatNum(b[1] + ny * tick, 3)}" stroke="${color}" stroke-width=".07"/>
        <text x="${formatNum(mid[0], 3)}" y="${formatNum(mid[1] - .28, 3)}" fill="${color}" font-family="'Cascadia Mono', Consolas, monospace" font-size=".7" text-anchor="middle">${formatNum(len, 2)} m</text>
      </g>`;
    }
    return '';
  };

  const buildSVG = () => {
    const entities = getVisibleEntities();
    const bounds = unionBounds(entities) || { x: 0, y: 0, w: 40, h: 30 };
    const pad = 3.4;
    const titleH = 8.4;
    const originX = bounds.x - pad;
    const originY = bounds.y - pad;
    const planW = bounds.w + pad * 2;
    const planH = bounds.h + pad * 2;
    const totalW = planW;
    const totalH = planH + titleH;
    const grid = state.doc.gridSize || 1;
    const major = grid * 5;
    const pxWidth = Math.round(clamp(totalW * 40, 1200, 3600));
    const pxHeight = Math.round(pxWidth * (totalH / totalW));
    const titleY = originY + planH;
    const now = new Date();
    const dateLabel = now.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' }).toUpperCase();
    const layerCount = state.doc.layers.filter((l) => l.visible !== false).length;

    const defs = `<defs>
      <pattern id="minorGrid" width="${formatNum(grid, 3)}" height="${formatNum(grid, 3)}" patternUnits="userSpaceOnUse">
        <path d="M ${formatNum(grid, 3)} 0 L 0 0 0 ${formatNum(grid, 3)}" fill="none" stroke="#77aaa5" stroke-opacity=".075" stroke-width=".035"/>
      </pattern>
      <pattern id="majorGrid" width="${formatNum(major, 3)}" height="${formatNum(major, 3)}" patternUnits="userSpaceOnUse">
        <rect width="${formatNum(major, 3)}" height="${formatNum(major, 3)}" fill="url(#minorGrid)"/>
        <path d="M ${formatNum(major, 3)} 0 L 0 0 0 ${formatNum(major, 3)}" fill="none" stroke="#8abdb7" stroke-opacity=".12" stroke-width=".06"/>
      </pattern>
      <linearGradient id="sheetFade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#0d1719"/>
        <stop offset="0.6" stop-color="#091113"/>
        <stop offset="1" stop-color="#070d0f"/>
      </linearGradient>
    </defs>`;

    let underlay = '';
    if (state.doc.image?.visible !== false && state.doc.image?.dataUrl) {
      const im = state.doc.image;
      underlay = `<image href="${im.dataUrl}" x="${formatNum(im.x, 3)}" y="${formatNum(im.y, 3)}" width="${formatNum(im.w, 3)}" height="${formatNum(im.h, 3)}" opacity="${formatNum(im.opacity ?? 0.42, 2)}" preserveAspectRatio="none"/>`;
    }

    const entityMarkup = entities.map(svgEntity).filter(Boolean).join('\n');
    const axis = `<g stroke="#cd7647" stroke-opacity=".23" stroke-width=".05">
      ${originX < 0 && originX + planW > 0 ? `<line x1="0" y1="${formatNum(originY, 3)}" x2="0" y2="${formatNum(originY + planH, 3)}"/>` : ''}
      ${originY < 0 && originY + planH > 0 ? `<line x1="${formatNum(originX, 3)}" y1="0" x2="${formatNum(originX + planW, 3)}" y2="0"/>` : ''}
    </g>`;

    const title = `<g id="title-block">
      <rect x="${formatNum(originX, 3)}" y="${formatNum(titleY, 3)}" width="${formatNum(totalW, 3)}" height="${formatNum(titleH, 3)}" fill="#0a1214" stroke="#3d5a5d" stroke-width=".085"/>
      <line x1="${formatNum(originX + totalW * 0.62, 3)}" y1="${formatNum(titleY, 3)}" x2="${formatNum(originX + totalW * 0.62, 3)}" y2="${formatNum(titleY + titleH, 3)}" stroke="#2b4245" stroke-width=".06"/>
      <line x1="${formatNum(originX + totalW * 0.62, 3)}" y1="${formatNum(titleY + titleH * 0.52, 3)}" x2="${formatNum(originX + totalW, 3)}" y2="${formatNum(titleY + titleH * 0.52, 3)}" stroke="#2b4245" stroke-width=".06"/>
      <line x1="${formatNum(originX, 3)}" y1="${formatNum(titleY + titleH * 0.64, 3)}" x2="${formatNum(originX + totalW * 0.62, 3)}" y2="${formatNum(titleY + titleH * 0.64, 3)}" stroke="#2b4245" stroke-width=".05"/>
      <text x="${formatNum(originX + 0.9, 3)}" y="${formatNum(titleY + 1.05, 3)}" fill="#cd7647" font-family="'Arial Narrow', Arial, sans-serif" font-size=".52" letter-spacing=".34">FOGFORGE / TRIAL GROUNDS CARTOGRAPHER</text>
      <text x="${formatNum(originX + 0.9, 3)}" y="${formatNum(titleY + 3.2, 3)}" fill="#e7e1d5" font-family="'Arial Narrow', Arial, sans-serif" font-size="2.05" letter-spacing=".02">${escapeHTML(state.doc.name)}</text>
      <text x="${formatNum(originX + 0.9, 3)}" y="${formatNum(titleY + 4.7, 3)}" fill="#8fa39f" font-family="'Cascadia Mono', Consolas, monospace" font-size=".58" letter-spacing=".12">${escapeHTML(state.doc.realm.toUpperCase())} · SURVEY SHEET · SCALE 1:100</text>
      <text x="${formatNum(originX + 0.9, 3)}" y="${formatNum(titleY + 6.35, 3)}" fill="#5f7572" font-family="'Cascadia Mono', Consolas, monospace" font-size=".48" letter-spacing=".08">${entities.length} OBJECTS · ${layerCount} LAYERS · ${dateLabel}</text>
      <text x="${formatNum(originX + totalW * 0.62 + 0.9, 3)}" y="${formatNum(titleY + 1.15, 3)}" fill="#5f7572" font-family="'Cascadia Mono', Consolas, monospace" font-size=".46" letter-spacing=".16">SHEET</text>
      <text x="${formatNum(originX + totalW * 0.62 + 0.9, 3)}" y="${formatNum(titleY + 2.4, 3)}" fill="#d8d1c4" font-family="'Arial Narrow', Arial, sans-serif" font-size="1.05">TRIAL / 01</text>
      <text x="${formatNum(originX + totalW - 0.9, 3)}" y="${formatNum(titleY + 2.4, 3)}" fill="#7ed8cf" font-family="'Cascadia Mono', Consolas, monospace" font-size=".5" text-anchor="end">FOGFORGE v1.0</text>
      <text x="${formatNum(originX + totalW * 0.62 + 0.9, 3)}" y="${formatNum(titleY + titleH * 0.52 + 1.15, 3)}" fill="#5f7572" font-family="'Cascadia Mono', Consolas, monospace" font-size=".46" letter-spacing=".16">EXTENT</text>
      <text x="${formatNum(originX + totalW * 0.62 + 0.9, 3)}" y="${formatNum(titleY + titleH * 0.52 + 2.4, 3)}" fill="#c7c0b3" font-family="'Cascadia Mono', Consolas, monospace" font-size=".64">${formatNum(bounds.w, 1)} × ${formatNum(bounds.h, 1)} m</text>
      <g transform="translate(${formatNum(originX + totalW - 10.5, 3)} ${formatNum(titleY + titleH * 0.52 + 1.9, 3)})">
        <line x1="0" y1="0" x2="8" y2="0" stroke="#8fa39f" stroke-width=".08"/>
        <line x1="0" y1="-.2" x2="0" y2=".2" stroke="#8fa39f" stroke-width=".08"/>
        <line x1="4" y1="-.15" x2="4" y2=".15" stroke="#8fa39f" stroke-width=".06"/>
        <line x1="8" y1="-.2" x2="8" y2=".2" stroke="#8fa39f" stroke-width=".08"/>
        <text x="0" y=".8" fill="#5f7572" font-family="'Cascadia Mono', Consolas, monospace" font-size=".42" text-anchor="middle">0</text>
        <text x="8" y=".8" fill="#5f7572" font-family="'Cascadia Mono', Consolas, monospace" font-size=".42" text-anchor="middle">8 m</text>
      </g>
    </g>`;

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${pxWidth}" height="${pxHeight}" viewBox="${formatNum(originX, 3)} ${formatNum(originY, 3)} ${formatNum(totalW, 3)} ${formatNum(totalH, 3)}" role="img" aria-label="${svgSafe(state.doc.name)} blueprint">
      <title>${escapeHTML(state.doc.name)} — Fogforge trial grounds survey</title>
      ${defs}
      <rect x="${formatNum(originX, 3)}" y="${formatNum(originY, 3)}" width="${formatNum(totalW, 3)}" height="${formatNum(totalH, 3)}" fill="url(#sheetFade)"/>
      <rect x="${formatNum(originX, 3)}" y="${formatNum(originY, 3)}" width="${formatNum(planW, 3)}" height="${formatNum(planH, 3)}" fill="url(#majorGrid)"/>
      ${underlay}
      ${axis}
      <g id="geometry">
        ${entityMarkup}
      </g>
      <rect x="${formatNum(originX, 3)}" y="${formatNum(originY, 3)}" width="${formatNum(planW, 3)}" height="${formatNum(planH, 3)}" fill="none" stroke="#3d5a5d" stroke-width=".09"/>
      <rect x="${formatNum(originX, 3)}" y="${formatNum(originY, 3)}" width="${formatNum(planW, 3)}" height="${formatNum(planH + titleH, 3)}" fill="none" stroke="#4d6b6e" stroke-width=".12"/>
      ${title}
    </svg>`;
  };

  const exportSVG = () => {
    try {
      const svg = buildSVG();
      downloadText(svg, `${slugify(state.doc.name)}.svg`, 'image/svg+xml;charset=utf-8');
      persistNow();
      toast('Vector exported', `${slugify(state.doc.name)}.svg`);
    } catch (error) {
      toast('SVG export failed', 'The vector sheet could not be generated.', 'error', 4200);
    }
  };

  const exportPNG = () => {
    try {
      const svg = buildSVG();
      const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const image = new Image();
      image.onload = () => {
        try {
          const targetWidth = clamp(image.width || 2400, 1400, 3600);
          const ratio = targetWidth / (image.width || targetWidth);
          const targetHeight = Math.round((image.height || 1200) * ratio);
          const sheet = document.createElement('canvas');
          sheet.width = targetWidth;
          sheet.height = targetHeight;
          const g = sheet.getContext('2d');
          g.fillStyle = '#081012';
          g.fillRect(0, 0, sheet.width, sheet.height);
          g.drawImage(image, 0, 0, sheet.width, sheet.height);
          sheet.toBlob((png) => {
            URL.revokeObjectURL(url);
            if (!png) {
              toast('PNG export failed', 'The browser could not encode the sheet.', 'error');
              return;
            }
            downloadBlob(png, `${slugify(state.doc.name)}.png`);
            persistNow();
            toast('Blueprint exported', `${slugify(state.doc.name)}.png · ${targetWidth}px wide.`);
          }, 'image/png');
        } catch (error) {
          URL.revokeObjectURL(url);
          toast('PNG export failed', 'The sheet could not be rasterised.', 'error');
        }
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        toast('PNG export failed', 'The vector sheet could not be decoded.', 'error');
      };
      image.src = url;
    } catch (error) {
      toast('PNG export failed', 'The blueprint sheet could not be generated.', 'error', 4200);
    }
  };

  // ── Demo map & startup ───────────────────────────────────────────────────

  const addDemoPreset = (doc, presetId, x, y, rotation = 0, name = null) => {
    const preset = PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    const objects = materializePreset(preset, x, y, rotation, name || preset.name);
    doc.entities.push(...objects);
  };

  const buildDemoDoc = () => {
    const doc = createBlankDoc('Macmillan Estate — Survey 01', 'Macmillan Estate');
    addDemoPreset(doc, 'main-building', 0, 0);
    addDemoPreset(doc, 'killer-shack', -30, -2);
    addDemoPreset(doc, 'harvester', 31, 2);
    addDemoPreset(doc, 'jungle-gym', -9, 25);
    addDemoPreset(doc, 't-wall', 28, 26);
    addDemoPreset(doc, 'cow-tree', -34, 25);
    addDemoPreset(doc, 'exit-gate', 14, -25);
    addDemoPreset(doc, 'exit-gate', -9, 42, 180, 'Exit Gate — South');

    doc.entities.push(normalizeEntity({
      type: 'polyline', layer: 'labels', name: 'Trial boundary',
      points: [[-48, -36], [49, -36], [49, 48], [-48, 48]],
      closed: true, filled: false, fill: '#7ed8cf',
      stroke: '#7ed8cf', strokeWidth: 0.09, opacity: 0.36, dash: 'dashed', rotation: 0
    }));
    doc.entities.push(normalizeEntity({
      type: 'text', layer: 'labels', name: 'Estate title',
      x: 0, y: -42, text: 'MACMILLAN ESTATE', fontSize: 2.6,
      color: '#a9a395', opacity: 0.24, rotation: 0, stroke: '#a9a395', strokeWidth: 0
    }));
    doc.entities.push(normalizeEntity({
      type: 'text', layer: 'labels', name: 'Survey subtitle',
      x: 0, y: 52, text: 'TRIAL GROUNDS / SURVEY 01 / SCALE 1:100', fontSize: 0.85,
      color: '#7ed8cf', opacity: 0.42, rotation: 0, stroke: '#7ed8cf', strokeWidth: 0
    }));
    doc.entities.push(normalizeEntity({
      type: 'marker', layer: 'props', name: 'Hatch', markerType: 'hatch',
      x: 7.4, y: 33, size: 1.6, rotation: 0, opacity: 0.9
    }));
    doc.entities.push(normalizeEntity({
      type: 'marker', layer: 'props', name: 'Generator', markerType: 'generator',
      x: -19, y: -18, size: 1.7, rotation: 0, opacity: 0.9
    }));
    doc.entities.push(normalizeEntity({
      type: 'measure', layer: 'labels', name: 'Estate width',
      points: [[-48, 55], [49, 55]], stroke: '#7ed8cf', strokeWidth: 0.06,
      opacity: 0.55, filled: false, fill: '#7ed8cf', dash: 'solid', rotation: 0
    }));
    return doc;
  };

  const loadInitialDocument = () => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && Array.isArray(parsed.entities)) return normalizeDoc(parsed);
      }
    } catch (error) {
      // Corrupt local copy - fall back to the demo sheet.
    }
    return buildDemoDoc();
  };

  const openHelp = () => {
    const dialog = $('#helpDialog');
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  };

  const toggleGridSnap = () => toggleSnapSetting('snapGrid');
  const toggleGeomSnap = () => toggleSnapSetting('snapGeom');
  const toggleOrtho = () => toggleSnapSetting('ortho');

  const handleGlobalKey = (event) => {
    const typing = isTypingTarget(event.target);
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key;
    const lower = key.toLowerCase();

    if (mod && lower === 'k') {
      event.preventDefault();
      const input = $('#commandInput');
      input.focus();
      input.select();
      return;
    }
    if (typing) return;

    if (mod) {
      if (lower === 'z' && !event.shiftKey) { event.preventDefault(); undo(); return; }
      if ((lower === 'z' && event.shiftKey) || lower === 'y') { event.preventDefault(); redo(); return; }
      if (lower === 'd') { event.preventDefault(); duplicateSelection(); return; }
      if (lower === 'g' && event.shiftKey) { event.preventDefault(); ungroupSelection(); return; }
      if (lower === 'g') { event.preventDefault(); groupSelection(); return; }
      if (lower === 'a') { event.preventDefault(); selectAll(); return; }
      if (lower === 's') { event.preventDefault(); saveCopy(); return; }
      if (lower === 'o') { event.preventDefault(); $('#fileMapInput').click(); return; }
      return;
    }

    if (key === 'Escape') {
      closeCommandSuggest();
      $('#exportMenu').classList.remove('open');
      if (!$('#touchActions').hidden) {
        hideTouchActions();
        return;
      }
      if (closeDrawers()) return;
      if (cancelDrag()) return;
      if (state.draft) {
        state.draft = null;
        state.snap = null;
        updatePrompt();
        scheduleDraw();
      } else if (state.selection.size) {
        setSelection([]);
      } else if (state.tool !== 'select') {
        setTool('select');
      }
      return;
    }

    if (key === 'Enter') {
      if (state.draft) {
        event.preventDefault();
        finishChain(false);
      }
      return;
    }

    if (key === 'Delete' || key === 'Backspace') {
      if (state.selection.size) {
        event.preventDefault();
        deleteSelection();
      }
      return;
    }

    if (key.startsWith('Arrow')) {
      if (!state.selection.size) return;
      event.preventDefault();
      const step = (state.doc.gridSize || 1) * (event.shiftKey ? 10 : 1);
      if (key === 'ArrowLeft') nudgeSelection(-step, 0);
      if (key === 'ArrowRight') nudgeSelection(step, 0);
      if (key === 'ArrowUp') nudgeSelection(0, -step);
      if (key === 'ArrowDown') nudgeSelection(0, step);
      return;
    }

    if (key === ' ') {
      event.preventDefault();
      state.spaceDown = true;
      return;
    }

    if (event.shiftKey) {
      if (lower === 'g') { event.preventDefault(); toggleGridSnap(); return; }
      if (lower === 'p') { event.preventDefault(); toggleGeomSnap(); return; }
      if (lower === 'o') { event.preventDefault(); toggleOrtho(); return; }
    }

    const shortcutTools = {
      v: 'select', h: 'pan', l: 'line', p: 'polyline', r: 'rect', c: 'circle',
      e: 'ellipse', g: 'polygon', a: 'arc', w: 'wall', t: 'text', m: 'marker', u: 'measure'
    };
    if (shortcutTools[lower]) {
      event.preventDefault();
      setTool(shortcutTools[lower]);
      return;
    }
    if (lower === 'f') { event.preventDefault(); fitToContent(); return; }
    if (lower === '?' || (key === '/' && event.shiftKey)) { event.preventDefault(); openHelp(); }
  };

  const handleGlobalKeyUp = (event) => {
    if (event.key === ' ') state.spaceDown = false;
  };

  // ── Mobile drawers ───────────────────────────────────────────────────────

  const closeDrawers = () => {
    const wasOpen = document.body.classList.contains('drawer-library')
      || document.body.classList.contains('drawer-inspector');
    document.body.classList.remove('drawer-library', 'drawer-inspector');
    $('#libraryToggle').classList.remove('active');
    $('#inspectorToggle').classList.remove('active');
    $('#libraryToggle').setAttribute('aria-expanded', 'false');
    $('#inspectorToggle').setAttribute('aria-expanded', 'false');
    return wasOpen;
  };

  const openDrawer = (name) => {
    if (!isPhoneLayout()) return;
    hideTouchActions();
    closeDrawers();
    document.body.classList.add(`drawer-${name}`);
    const button = $(name === 'library' ? '#libraryToggle' : '#inspectorToggle');
    button.classList.add('active');
    button.setAttribute('aria-expanded', 'true');
  };

  const toggleDrawer = (name) => {
    if (!isPhoneLayout()) return;
    if (document.body.classList.contains(`drawer-${name}`)) closeDrawers();
    else openDrawer(name);
  };

  const bindUI = () => {
    $$('.tool-btn[data-tool]').forEach((button) => {
      button.addEventListener('click', () => setTool(button.dataset.tool));
    });
    $('#fitBtn').addEventListener('click', fitToContent);
    $('#undoBtn').addEventListener('click', undo);
    $('#redoBtn').addEventListener('click', redo);
    $('#newBtn').addEventListener('click', newMap);
    $('#openBtn').addEventListener('click', () => $('#fileMapInput').click());
    $('#helpBtn').addEventListener('click', openHelp);
    $('#helpClose').addEventListener('click', () => $('#helpDialog').close());
    $('#libraryToggle').addEventListener('click', () => toggleDrawer('library'));
    $('#inspectorToggle').addEventListener('click', () => toggleDrawer('inspector'));
    $('#drawerScrim').addEventListener('click', closeDrawers);
    $('#touchDeleteBtn').addEventListener('click', () => {
      if (state.selection.size) deleteSelection();
      hideTouchActions();
    });
    $('#touchCloseBtn').addEventListener('click', hideTouchActions);
    document.addEventListener('pointerdown', (event) => {
      if (!event.target.closest('#touchActions')) hideTouchActions();
    }, true);
    window.addEventListener('resize', () => {
      if (!isPhoneLayout()) closeDrawers();
      hideTouchActions();
    });
    $('#docTitle').addEventListener('click', () => {
      const next = window.prompt('Map name', state.doc.name);
      if (next === null) return;
      const name = next.trim();
      if (!name) return;
      state.doc.name = name;
      updateTopbar();
      commit('Rename map');
      updateInspector();
    });

    $('#exportBtn').addEventListener('click', (event) => {
      event.stopPropagation();
      $('#exportMenu').classList.toggle('open');
    });
    $('#exportMenu').addEventListener('click', (event) => {
      const button = event.target.closest('[data-export]');
      if (!button) return;
      $('#exportMenu').classList.remove('open');
      const kind = button.dataset.export;
      if (kind === 'png') exportPNG();
      if (kind === 'svg') exportSVG();
      if (kind === 'json') saveCopy();
      if (kind === 'import') $('#fileMapInput').click();
    });
    document.addEventListener('click', (event) => {
      if (!event.target.closest('.menu-wrap')) $('#exportMenu').classList.remove('open');
    });

    $('#gridSnapBtn').addEventListener('click', toggleGridSnap);
    $('#geomSnapBtn').addEventListener('click', toggleGeomSnap);
    $('#orthoBtn').addEventListener('click', toggleOrtho);
    $('#statusGridBtn').addEventListener('click', () => {
      state.doc.showGrid = !state.doc.showGrid;
      commit('Toggle grid');
      updateStatus();
      updateInspector();
      scheduleDraw();
    });
    $('#statusSnapBtn').addEventListener('click', () => {
      const on = !(state.doc.snapGrid || state.doc.snapGeom);
      state.doc.snapGrid = on;
      state.doc.snapGeom = on;
      commit('Toggle snapping');
      updateStatus();
      updateInspector();
      scheduleDraw();
    });
    $('#zoomInBtn').addEventListener('click', () => zoomBy(1.28));
    $('#zoomOutBtn').addEventListener('click', () => zoomBy(0.78));
    $('#zoomFitBtn').addEventListener('click', fitToContent);

    $$('.lib-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        $$('.lib-tab').forEach((other) => other.classList.toggle('active', other === tab));
        $$('.lib-panel').forEach((panel) => panel.classList.toggle('active', panel.id === `tab-${tab.dataset.tab}`));
      });
    });
    $('#presetFilters').addEventListener('click', (event) => {
      const filter = event.target.closest('[data-filter]');
      if (!filter) return;
      $$('#presetFilters .filter').forEach((button) => button.classList.toggle('active', button === filter));
      renderPresets(filter.dataset.filter);
    });
    $('#presetGrid').addEventListener('click', (event) => {
      const card = event.target.closest('[data-preset]');
      if (!card) return;
      const preset = PRESETS.find((p) => p.id === card.dataset.preset);
      if (preset) {
        insertPreset(preset);
        closeDrawers();
      }
    });
    $('#propGrid').addEventListener('click', (event) => {
      const card = event.target.closest('[data-marker]');
      if (!card) return;
      state.activeMarker = card.dataset.marker;
      setTool('marker');
      renderProps();
      renderToolOptions();
      closeDrawers();
    });
    $('#layerList').addEventListener('click', (event) => {
      const select = event.target.closest('[data-layer-select]');
      if (select) {
        state.activeLayer = select.dataset.layerSelect;
        renderLayers();
        updateStatus();
        return;
      }
      const toggle = event.target.closest('[data-layer-toggle]');
      if (toggle) {
        const layer = layerById(toggle.dataset.layerToggle);
        if (!layer) return;
        layer.visible = layer.visible === false;
        commit(`${layer.visible ? 'Show' : 'Hide'} layer`);
        renderLayers();
        updateStatus();
        scheduleDraw();
        return;
      }
      const lock = event.target.closest('[data-layer-lock]');
      if (lock) {
        const layer = layerById(lock.dataset.layerLock);
        if (!layer) return;
        layer.locked = !layer.locked;
        commit(`${layer.locked ? 'Lock' : 'Unlock'} layer`);
        renderLayers();
        updateStatus();
        scheduleDraw();
      }
    });
    $('#addLayerBtn').addEventListener('click', () => {
      const name = window.prompt('New layer name', `Layer ${state.doc.layers.length + 1}`);
      if (!name?.trim()) return;
      const palette = ['#c9a05f', '#7ed8cf', '#a88bd4', '#cf7968', '#82bfd1', '#b0a68f'];
      state.doc.layers.push({
        id: `${slugify(name)}-${uid('l')}`,
        name: name.trim(),
        color: palette[state.doc.layers.length % palette.length],
        visible: true,
        locked: false
      });
      commit('Add layer');
      renderLayers();
      updateInspector();
      toast('Layer added', name.trim());
    });

    $('#emptyPresetBtn').addEventListener('click', () => {
      $$('.lib-tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === 'presets'));
      $$('.lib-panel').forEach((panel) => panel.classList.toggle('active', panel.id === 'tab-presets'));
      renderPresets('all');
      openDrawer('library');
    });
    $('#emptyDrawBtn').addEventListener('click', () => {
      setTool('rect');
      canvas.focus();
    });

    const commandInput = $('#commandInput');
    commandInput.addEventListener('input', () => renderCommandSuggest(commandInput.value));
    commandInput.addEventListener('focus', () => {
      if (commandInput.value) renderCommandSuggest(commandInput.value);
    });
    commandInput.addEventListener('keydown', (event) => {
      const box = $('#commandSuggest');
      const rows = $$('.suggest-row', box);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (!rows.length) return;
        event.preventDefault();
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        state.commandIndex = (state.commandIndex + direction + rows.length) % rows.length;
        rows.forEach((row, index) => row.classList.toggle('active', index === state.commandIndex));
        rows[state.commandIndex].scrollIntoView({ block: 'nearest' });
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        if (state.commandIndex >= 0 && rows[state.commandIndex]) {
          const command = rows[state.commandIndex].dataset.command;
          commandInput.value = '';
          executeCommand(command);
          closeCommandSuggest();
        } else {
          submitCommand();
        }
        return;
      }
      if (event.key === 'Escape') {
        closeCommandSuggest();
        commandInput.blur();
      }
    });
    $('#commandSuggest').addEventListener('click', (event) => {
      const row = event.target.closest('[data-command]');
      if (!row) return;
      commandInput.value = '';
      executeCommand(row.dataset.command);
      closeCommandSuggest();
      commandInput.blur();
    });
    document.addEventListener('click', (event) => {
      if (!event.target.closest('.commandbar')) closeCommandSuggest();
    });

    const textDialog = $('#textDialog');
    $('#textForm').addEventListener('submit', (event) => {
      if (event.submitter?.value !== 'default') return;
      event.preventDefault();
      placeTextLabel();
      textDialog.close();
    });
    textDialog.addEventListener('close', () => {
      state.textPoint = null;
      $('#textInput').value = '';
      canvas.focus();
    });

    const surveyDialog = $('#surveyDialog');
    $('#surveyBtn').addEventListener('click', () => openSurvey());
    surveyDialog.addEventListener('input', updateSurveyPreview);
    surveyDialog.addEventListener('change', updateSurveyPreview);
    $('#surveyForm').addEventListener('submit', (event) => {
      event.preventDefault();
      if (event.submitter?.id !== 'surveyInsert') return;
      if (insertSurveyOutline()) surveyDialog.close();
    });
    $('#surveyClose').addEventListener('click', () => surveyDialog.close());
    $('#surveyCancel').addEventListener('click', () => surveyDialog.close());
    $('#surveyInput').addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        if (insertSurveyOutline()) surveyDialog.close();
      }
    });
    surveyDialog.addEventListener('close', () => {
      $('#surveyMessage').textContent = '';
      $('#surveyMessage').className = 'survey-message';
      canvas.focus();
    });

    $('#fileMapInput').addEventListener('change', (event) => {
      const file = event.target.files?.[0];
      if (file) importMap(file);
      event.target.value = '';
    });
    $('#fileImageInput').addEventListener('change', (event) => {
      const file = event.target.files?.[0];
      if (file) importUnderlayFile(file);
      event.target.value = '';
    });

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerCancel);
    canvas.addEventListener('pointerleave', () => {
      if (!state.drag && !state.marquee && !state.pan) {
        state.hoverEntity = null;
        state.hoverHandle = null;
        scheduleDraw();
      }
    });
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContextMenu);
    canvas.addEventListener('dblclick', onDoubleClick);
    window.addEventListener('keydown', handleGlobalKey);
    window.addEventListener('keyup', handleGlobalKeyUp);
    window.addEventListener('beforeunload', persistNow);
    window.addEventListener('blur', () => {
      state.spaceDown = false;
      state.touchPoints.clear();
      state.pinch = null;
      cancelLongPress();
      hideTouchActions();
    });
    if (window.ResizeObserver) {
      const observer = new ResizeObserver(() => resizeCanvas());
      observer.observe(stage);
    } else {
      window.addEventListener('resize', resizeCanvas);
    }
    bindInspectorEvents();
  };

  const init = () => {
    state.doc = loadInitialDocument();
    state.activeLayer = 'structure';
    underlayImage = null;
    underlaySrc = '';
    renderPresets('all');
    renderProps();
    renderLayers();
    updateTopbar();
    updateMode();
    updateInspector();
    updateHistoryButtons();
    updateStatus();
    $('#emptyState').classList.toggle('is-hidden', state.doc.entities.length > 0);
    bindUI();
    loadUnderlayImage();
    resizeCanvas();
    fitToContent();
    initHistory();
    updateUI();
    requestAnimationFrame(() => {
      resizeCanvas();
      fitToContent();
    });
    setTimeout(() => persistNow(), 600);
  };

  const registerServiceWorker = () => {
    if (!('serviceWorker' in navigator) || location.protocol !== 'https:') return;
    navigator.serviceWorker.register('sw.js').catch(() => {
      // Offline support is optional.
    });
  };

  init();
  registerServiceWorker();
})();
