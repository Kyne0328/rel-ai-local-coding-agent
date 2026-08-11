# Dashboard feature structure

The dashboard uses a feature-first structure. Each user-facing capability owns its entry point and feature-specific implementation details under this directory.

## Feature boundaries

- `home/` owns the overview experience.
- `sessions/` owns session history and active operation views.
- `workspaces/` owns workspace rendering, actions, forms, repair flows, recent-workspace state, and feature styling.
- `skills/` owns the reusable skill library, GitHub installation, and per-workspace skill assignment.
- `activity/` owns activity history and filtering.
- `settings/` owns application preference and configuration panels.
- `tools/` owns the tool reference experience.
- `onboarding/` owns browser onboarding and desktop handoff behavior.

Cross-feature infrastructure remains in `src/ui/`: routing, API access, shared state, interaction safety, preferences, and connection state. Reusable visual primitives remain in `src/ui/components/`.

## Rules for new UI code

1. Add user-facing behavior to the feature that owns it; do not create another generic `sections` or `pages` directory.
2. Keep imports between features explicit. Move logic to shared infrastructure only when at least two features require the same stable behavior.
3. Put feature-only CSS beside the feature and import it from `src/ui/styles/app.css`.
4. Use Tailwind utilities for layout, spacing, and responsive composition. Use named component classes for product-specific states and semantics.
5. Keep `public/dashboard.css` generated. Edit the CSS sources under `src/ui/`, then run `npm run build:css`.
