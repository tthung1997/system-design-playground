# system-design-playground
Interactive system design diagrams and learning challenges.

This repository currently contains the **diagram editor**. Numeric simulation (capacity, load, cost), lessons/challenges and deployment are not included yet; the focus is on how traffic flows between components.

## Getting started

```bash
npm install
npm run dev        # start the app on http://localhost:5173
npm test           # run the model and store tests
npm run typecheck  # TypeScript project check
npm run build      # production build into dist/
```

## What you can do

- **Build diagrams** (React Flow): drag components (clients, CDN, load balancer, service, cache, queue, database) onto the canvas and connect them. Connections fed by a client animate to show traffic moving through the system.
- **Describe components your way**: components start with just a name. Add any custom properties (name/value pairs such as region, owner or notes) from the Properties panel; the first few show on the component.
- **Spot loose ends**: the Checks panel warns about a missing Clients component or components no client can reach.
- **Save your work**: undo/redo (Ctrl+Z / Ctrl+Shift+Z), autosave to `localStorage`, JSON export/import, and presets. Files from the earlier numeric version still load; their numbers are ignored.

## Architecture

```
src/
  model/    plain serializable types, component kinds, presets, graph checks, document (de)serialization
  store/    Zustand store (graph, selection, undo/redo) + persistence
  ui/       React components (editor, palette, properties, toolbar)
  index.css Tailwind entry: theme tokens and a few shared component classes (btn, input, card)
```

Styling uses [Tailwind CSS](https://tailwindcss.com) v4. Traffic flows top to bottom through a **DAG**; connections that would create a cycle are rejected.
