# FOGFORGE — Trial Grounds Cartographer

A standalone, browser-based top-down map outline editor for Dead by Daylight trial
grounds. Draw structures with CAD-style tools, stamp editable building presets, and
export clean maps for planning, callouts, or overlays.

No build step, no dependencies, no server required. Open `index.html` and draw.

## Run it

- **Live web app:** <https://kablhamm.github.io/Fog-forge/> — works on desktop and
  phones, and can be installed to a home screen from the browser menu.
- **Directly:** double-click `fogforge/index.html`.
- **Local server:**

  ```powershell
  python -m http.server 4173
  ```

  Then open <http://127.0.0.1:4173/fogforge/>.

The app autosaves to `localStorage` under `fogforge.document.v1`. Use **OPEN** to load a
saved `.json` map and **EXPORT** to download one.

## First look

The app opens on a curated Macmillan Estate demo sheet. Use **NEW** for a blank trial
ground, or press **F** to fit whatever is on the sheet.

| Area | What it does |
| --- | --- |
| Left tool rail | Drawing and editing tools, presets, and layers |
| Centre canvas | The drafting sheet: pan, zoom, draw, select |
| Right inspector | Properties for the current selection or map settings |
| Top bar | Undo/redo, new/open, export menu, help |
| Bottom bar | Grid/snap toggles, zoom controls, and live prompts |
| Command line | `Ctrl+K`; accepts tool, preset, and export commands |

## Drawing tools

Every tool can be activated from the rail or with its keyboard shortcut.

| Tool | Key | Workflow |
| --- | --- | --- |
| Select | `V` | Pick, move, scale, rotate, and edit geometry |
| Pan | `H` | Drag the sheet; hold `Space` with any tool |
| Line | `L` | Chained independent segments; `Enter`/right-click ends the chain |
| Polyline | `P` | One connected path; click the first node to close it |
| Rectangle | `R` | Two opposite corners; hold `Shift` for a square |
| Circle | `C` | Centre, then radius |
| Ellipse | `E` | Bounding box; hold `Shift` to constrain |
| Polygon | `G` | Centre, then radius/rotation |
| 3-point arc | `A` | Start, a point along the curve, then end |
| Wall | `W` | Wall chain with live thickness; click the first node to close |
| Label | `T` | Place a text annotation |
| Marker | `M` | Stamp a trial prop (pallet, vault, generator, hook, etc.) |
| Measure | `U` | Temporary dimension between two points |

Actions can be ended with `Enter` (finish a chain), `Esc` (cancel the draft), or a
right-click. Hold `Shift` while drawing to constrain to ortho. Escape during a drag
cancels the move, scale, rotate, or node edit and restores the original geometry.

Tools stay active after a shape so you can draw repeatedly. Turn off **Keep tool
active** in the tool options to return to Select after each shape.

## Structure presets

The **STRUCTURE LIBRARY** on the left contains fully editable vector presets:

- Main Building
- Killer Shack
- Harvester
- Jungle Gym
- T-Wall
- L/T Wall
- Cow Tree
- Exit Gate

Click a preset to place it at the centre of the view. A preset is inserted as a group:
click any piece to move the whole structure, or hold `Alt` while clicking to edit one
wall or prop. Presets can also be inserted from the command line, for example
`PRESET SHACK` or `INSERT JUNGLE GYM`.

The **TRIAL PROPS** palette stamps individual markers: pallet, vault, generator, hook,
totem, chest, hatch, exit gate, basement, stairs, and locker. Marker type, size, colour,
and rotation stay editable in the inspector.

## Walk a survey outline

Use **WALK AN OUTLINE** in the tool panel (or the `SURVEY` command) to build a closed
perimeter from a walk. Enter each straight run and the turn at its end; distances are in
metres and turns are clockwise unless marked left.

```text
12 R90
8 R90
12 R90
8
```

`R90` turns right, `L45` turns left, and a bare list such as `12 8 6 14` assumes a 90°
right turn between sides. Spreadsheet-style rows work too: `12, 90` or `8, -90`. Turn on
**Snap lengths to grid** to round each run to the current grid size, adjust the start
point and heading, then **INSERT OUTLINE**. The preview reports perimeter, area, and any
gap back to the start.

## Precision and navigation

- **Grid snapping** — `Shift+G`
- **Point/edge snapping** — `Shift+P`; grabs endpoints, corners, centres, midpoints,
  and edges from every visible, unlocked layer
- **Ortho toggle** — `Shift+O`
- **Hold `Shift`** — ortho while drawing, axis-lock while moving, uniform scale, or
  15° rotation steps
- **Scroll** — zoom around the pointer
- **Pinch** — zoom on a touch screen; drag with two fingers to pan
- **`F`** — fit all geometry to the view
- **`Space` + drag / middle-drag** — pan with any tool

## On a phone

The map canvas fills the screen. The drawing tools sit in a horizontal strip along the
bottom — swipe the strip sideways to reach every tool. The two icons at the top right
slide in the **library** (presets, props, layers) and the **inspector** (properties of the
selected object); tap the dimmed map or press `Esc` to close them. One finger draws,
selects, and drags objects; pinch zooms; a two-finger drag pans. With the **Select** tool,
press and hold an object for about half a second to reveal a floating **DELETE** button;
tap elsewhere, press `Esc`, or tap × to dismiss it.

## Selection and editing

- Drag inside a shape or room to move it; drag its edge to pick the wall line.
- Corner and edge handles scale. The circular handle above the frame rotates.
- For a single path, drag the round node handles to edit points.
- `Shift`-click adds to the selection; drag a marquee on empty space to select an area.
- `Alt`-click enters a group to select one child.
- Inspector fields edit exact position, size, rotation, stroke, fill, opacity, and layer.
- `Ctrl+G` groups, `Ctrl+Shift+G` ungroups, `Ctrl+D` duplicates, arrow keys nudge
  (hold `Shift` to nudge ×10).

## Layers

The **DRAWING LAYERS** panel controls visibility, locking, active-layer selection, and
creation. Locked or hidden layers cannot be picked. Presets use the `structure`,
`walls`, `props`, and `labels` layers; new layers can be added for separate map areas
or annotations.

## Command line

Press `Ctrl+K` and type. Commands are case-insensitive and support presets by name:

```text
RECT            WALL            PRESET SHACK
GRID OFF        SNAP ON         ORTHO ON
ZOOM FIT        EXPORT PNG      EXPORT SVG
GROUP           UNGROUP         SELECT ALL
SURVEY 12 R90 8 R90 12 R90 8
```

Start typing to see suggestions; the up/down arrow keys move through them, `Enter`
runs the highlighted command, and `Esc` closes the bar.

## Reference image underlay

Select nothing to show **Map settings** in the inspector, then use **Import reference
image**. The image is traced under the geometry and can be fitted, faded, or removed.
Images stay in the browser, are included in local autosaves, and are embedded in JSON
exports.

## Export formats

- **PNG** — blueprint sheet with title block, grid, and the full drawing.
- **SVG** — clean vector line work for further editing or print.
- **JSON** — the complete editable document, including presets, groups, layers,
  annotations, and any underlay image.

`Ctrl+S` downloads a JSON copy; **OPEN** restores it.

## Keyboard reference

| Action | Shortcut |
| --- | --- |
| Command line | `Ctrl+K` |
| Undo / redo | `Ctrl+Z` / `Ctrl+Shift+Z` or `Ctrl+Y` |
| Duplicate selection | `Ctrl+D` |
| Group / ungroup | `Ctrl+G` / `Ctrl+Shift+G` |
| Select all | `Ctrl+A` |
| Save JSON copy | `Ctrl+S` |
| Open map | `Ctrl+O` |
| Delete selection | `Delete` or `Backspace` |
| Nudge selection | Arrow keys (`Shift` = ×10) |
| Cancel drag / draft / selection | `Esc` |
| Finish chain | `Enter` |
| Fit to view | `F` |
| Help | `?` or `Shift+/` |

## File layout

```text
fogforge/
  index.html             App shell, panels, dialogs, and SVG icon sprite
  styles.css             Dark CAD/blueprint theme and responsive layout
  app.js                 Geometry, tools, presets, inspector, persistence, export
  manifest.webmanifest   Installable web-app metadata
  sw.js                  Optional offline cache
  icon.svg               Scalable app icon
  icon-192.png           Home-screen icon
  icon-512.png           High-resolution app icon
```

Everything is plain HTML, CSS, and JavaScript; there is nothing to install or build.
The live GitHub Pages deployment serves these files from the repository root.
