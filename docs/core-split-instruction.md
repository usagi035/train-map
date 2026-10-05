# Core Split Refactoring Instructions

## Objective

Refactor the current `train-map` codebase so that the application logic is separated from the Electron Renderer/UI layer.

The primary goal is **separation of responsibilities**, not simply splitting `renderer.js` into many smaller files.

The current application behavior must remain unchanged.

Do not rewrite the application architecture unnecessarily. Preserve the existing data format, UI behavior, keyboard/mouse behavior, import/export behavior, and existing features unless a change is strictly required for the refactor.

---

## Current Problem

The current `src/ui/renderer.js` contains too many responsibilities, including:

* application state
* map data model
* data creation helpers
* migration logic
* geometry calculations
* undo/redo
* editing operations
* selection
* layer handling
* SVG/canvas rendering
* side-panel rendering
* left-panel rendering
* tab management
* import/export
* event handlers
* storage synchronization

This makes the code difficult to maintain and makes future features such as online collaborative editing difficult to implement.

The refactor should establish a clean boundary between the application Core and the Electron/DOM UI.

---

# Target Architecture

Use approximately the following structure:

```text
src/
├── main/
│   └── main.js
│
├── core/
│   ├── model.js
│   ├── geometry.js
│   ├── migration.js
│   ├── history.js
│   └── operations.js
│
├── renderer/
│   ├── renderer.js
│   ├── canvas.js
│   ├── side-panel.js
│   ├── left-panel.js
│   └── tabs.js
│
└── ui/
    └── index.html
```

The exact filenames may be adjusted if a better structure is clearly justified, but the architectural separation must remain.

Do not create dozens of tiny modules merely to reduce line count.

---

# 1. Core Layer

The `core` layer must contain application/domain logic and must NOT depend on:

* DOM APIs
* `document`
* `window`
* SVG DOM elements
* Electron APIs
* browser event objects
* CSS/UI state

The Core should be usable independently of the Electron renderer.

A future WebSocket/server implementation should be able to call Core operations without needing the DOM.

---

# 2. model.js

Move data-model-related logic into `core/model.js`.

This includes, where appropriate:

* map creation
* line creation
* station creation
* road creation
* bus stop creation
* hub creation
* image creation
* label/box creation
* ID generation
* lookup helpers
* relationship helpers
* data normalization

Examples of existing functionality that should be considered:

```js
mkLine
mkRoad
mkBusStop
mkMap
mkStation
mkImage

findStation
linesOf
allStations
linksIn
linkGroups
flattenLinks
pruneLinks
```

The model must not know anything about how the objects are displayed.

---

# 3. geometry.js

Move pure geometry calculations into `core/geometry.js`.

Functions in this module should preferably be pure functions.

Examples include:

```js
dist
isLoop
segCount
segA
segB
segPt
project
keepCrossings
```

A geometry function should receive data as arguments and return a result.

Avoid accessing global application state from geometry functions unless absolutely necessary.

Example:

```js
const distance = dist(a, b);
```

is preferred over:

```js
dist(); // implicitly reads global state
```

---

# 4. migration.js

Move data migration and compatibility logic into `core/migration.js`.

This module is responsible for converting older map formats into the current internal format.

Migration logic should be independent of the UI.

Do not put migration logic into rendering code.

---

# 5. history.js

Move undo/redo management into `core/history.js`.

The current snapshot-based history implementation may be retained.

Do NOT replace snapshot history with an operation/event-sourcing system during this refactor.

The purpose of this task is separation, not redesign.

However, design the API so that the implementation can potentially be replaced by operation-based history later.

For example:

```js
history.push(...)
history.undo(...)
history.redo(...)
history.canUndo(...)
history.canRedo(...)
```

The UI should not need to know how history is internally implemented.

---

# 6. operations.js

This is the most important module.

Move application state mutations and editing operations here.

Examples:

```js
addStation
addHubStation
addBusStop
addRoadPoint
finishRoad
deleteElement
moveStation
setHub
```

Operations should modify application data through a controlled API rather than having UI code directly mutate the data model.

For example, prefer:

```js
core.addStation(...)
```

over:

```js
S.maps[currentMap].lines[line].stations.push(...)
```

inside renderer code.

The renderer should request an operation and then update the visual representation.

---

# 7. Core State

Avoid uncontrolled direct access to the global `S` object from UI code.

If practical, introduce a Core state boundary.

For example:

```js
const core = createCore(initialState);

core.getState();
core.addStation(...);
core.deleteElement(...);
core.moveStation(...);
```

Do not over-engineer this.

A simple state container is sufficient.

The important rule is:

> Renderer code should not directly mutate core application data.

Reading state is acceptable when necessary, but mutation should go through Core operations.

---

# 8. Renderer Layer

The Renderer layer is responsible for:

* DOM manipulation
* SVG manipulation
* UI rendering
* event listeners
* keyboard/mouse interaction
* menus
* panels
* tabs
* selection visualization
* translating user interaction into Core operations

The renderer should NOT contain domain logic.

For example:

```js
button.onclick = () => {
    core.addStation(...);
    render();
};
```

is good.

But:

```js
button.onclick = () => {
    map.lines[line].stations.push(...);
    // complex application logic
};
```

is not.

---

# 9. canvas.js

Move visual map rendering into `renderer/canvas.js`.

This module should deal with:

* SVG/canvas elements
* rendering stations
* rendering lines
* rendering roads
* rendering images
* rendering labels
* selection visualization
* viewport-related rendering

It may receive Core state as input.

It should not decide how the underlying application data should be changed.

---

# 10. Panels

Separate major UI panels where practical:

```text
renderer/side-panel.js
renderer/left-panel.js
```

These modules should contain UI construction and UI event handling.

They should call Core operations rather than directly modifying the data model.

Do not split every individual button into a separate module.

---

# 11. tabs.js

Move tab-management logic into `renderer/tabs.js`.

This includes:

* creating tabs
* switching tabs
* closing tabs
* tab selection UI
* tab-related DOM updates

Tab state that is purely UI-related may remain in the renderer layer.

Map/domain data must remain in Core.

---

# 12. renderer.js

After the refactor, `renderer.js` should become the orchestration layer.

Its responsibilities should primarily be:

1. Initialize Core.
2. Initialize Renderer modules.
3. Connect UI events to Core operations.
4. Trigger rendering.
5. Coordinate modules.

It should NOT remain a second monolithic application layer.

A rough structure:

```js
const core = createCore(...);

initializeCanvas(core);
initializePanels(core);
initializeTabs(core);

render();
```

---

# 13. Dependency Direction

Keep dependencies flowing in this direction:

```text
          Renderer/UI
              |
              v
             Core
              |
              v
        Data / Geometry
```

The Core must NOT import Renderer modules.

Avoid circular dependencies.

Bad:

```text
core -> renderer -> core
```

Good:

```text
renderer -> core
core -> model
core -> geometry
```

---

# 14. Online Collaboration Compatibility

Do not implement online collaboration in this task.

However, the resulting architecture must make it possible to add it later.

The intended future architecture is approximately:

```text
                 ┌───────────────┐
                 │     Core      │
                 │               │
                 │ Model         │
                 │ Operations   │
                 │ Geometry      │
                 │ History       │
                 └───────┬───────┘
                         │
             ┌───────────┴───────────┐
             │                       │
             ▼                       ▼
       Electron Renderer       Online Sync
                                  WebSocket
```

The Core must therefore not depend on Electron or the DOM.

A future WebSocket layer should be able to translate remote operations into Core operations without needing to interact with the UI directly.

---

# 15. Do Not Over-Refactor

Do NOT:

* rewrite the entire application
* change the data format unnecessarily
* replace the existing rendering system
* replace SVG with Canvas
* introduce a framework such as React/Vue/etc.
* introduce a state-management library
* implement WebSocket synchronization
* replace snapshot history with CRDT/event sourcing
* change the UI design
* change keyboard shortcuts
* change existing user-facing behavior

This is a structural refactor.

---

# 16. Preserve Existing Behavior

After every significant extraction, verify that:

* maps still load
* maps still save
* import/export still works
* stations work
* lines work
* roads work
* bus stops work
* hubs work
* images work
* labels/boxes work
* selection works
* deletion works
* movement works
* undo works
* redo works
* tabs work
* layers work
* keyboard shortcuts work
* mouse interaction works

Do not consider the refactor complete merely because the application starts.

---

# 17. Recommended Refactoring Order

Do the refactor incrementally.

Recommended order:

### Step 1

Extract pure geometry functions.

```text
renderer.js
    ↓
core/geometry.js
```

### Step 2

Extract model constructors and lookup helpers.

```text
renderer.js
    ↓
core/model.js
```

### Step 3

Extract migration logic.

```text
renderer.js
    ↓
core/migration.js
```

### Step 4

Extract history.

```text
renderer.js
    ↓
core/history.js
```

### Step 5

Extract state-mutating application operations.

```text
renderer.js
    ↓
core/operations.js
```

This step is the most important.

### Step 6

Extract visual rendering.

```text
renderer.js
    ↓
renderer/canvas.js
```

### Step 7

Extract panels and tabs.

```text
renderer.js
    ↓
renderer/side-panel.js
renderer/left-panel.js
renderer/tabs.js
```

### Step 8

Reduce `renderer.js` to orchestration.

---

# 18. API Design

Prefer small explicit APIs.

For example:

```js
const core = createCore(initialState);

core.getState();

core.addStation(...);
core.deleteElement(...);
core.moveStation(...);

core.addRoad(...);
core.addBusStop(...);

core.undo();
core.redo();
```

Avoid exposing large mutable objects when unnecessary.

Do not create an enormous `Core` class containing every function in the application.

The goal is clear boundaries, not abstraction for its own sake.

---

# 19. Testing / Verification

Before finishing:

1. Start the Electron application.
2. Load an existing map.
3. Create a new map.
4. Add and remove stations.
5. Add and modify lines.
6. Add roads.
7. Add bus stops/hubs.
8. Move objects.
9. Test selection.
10. Test undo/redo.
11. Test import/export.
12. Test tabs.
13. Test images.
14. Test layers.
15. Test keyboard shortcuts.
16. Check the browser console for errors.

If the project has existing tests, run them.

If a behavior changes because of the refactor, fix the regression rather than accepting the behavior change.

---

# 20. Final Acceptance Criteria

The refactor is considered successful when:

* `renderer.js` is substantially smaller and primarily orchestrates the application.
* Domain/application logic is located in `core/`.
* Geometry is independent and reusable.
* Core does not depend on DOM/Electron APIs.
* UI code does not directly mutate application state.
* Editing operations have a clear Core API.
* Undo/redo has a clear boundary.
* Existing functionality continues to work.
* The architecture can support a future WebSocket synchronization layer.
* There are no unnecessary abstractions or excessive tiny modules.

Most importantly:

> Do not optimize for the number of files.
> Optimize for clear responsibility boundaries and dependency direction.

If an existing function does not fit perfectly into one module, use judgment based on responsibility rather than forcing an artificial split.
