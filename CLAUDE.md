# ORBIT — Frontend Design Standards

These rules apply to every web interface of Orbit: the browser's own pages
(orbit://home, orbit://downloads, settings sheets…) and the community site
(`realshavkat/orbit-cloud`).

## Design philosophy
ORBIT is a premium desktop browser brand. Every web interface must
feel intentional, polished, distinctive, and production-ready.

Never ship a generic AI-generated SaaS dashboard aesthetic.

## Visual identity
- Near-black foundations with subtle surface separation.
- Violet and lavender are the primary brand accents.
- Use color intentionally, not as decoration everywhere.
- Maintain a clear typographic hierarchy.
- Keep text readable and secondary content sufficiently contrasted.
- Build a consistent spacing, radius, shadow, and color token system.

## Layout
- Establish a strong visual hierarchy on every page.
- Do not turn every section into a card.
- Avoid repetitive grids of identical dark rectangles.
- Use whitespace to communicate structure.
- Keep content widths, alignments and spacing consistent.
- Optimize for real desktop, tablet and mobile viewport sizes.

## Components
- Reuse existing project components when appropriate.
- Create reusable components when they eliminate genuine duplication.
- Use consistent icons from the project's existing icon library.
- Every interactive element must have appropriate hover, focus,
  active, disabled, loading and error states where relevant.
- All buttons and links must perform their advertised actions.

## Implementation
- Inspect the repository before changing code.
- Preserve routes, authentication, permissions and existing behavior.
- Never replace production data with hardcoded mock data.
- Avoid unnecessary dependencies and massive rewrites.
- Preserve accessibility, keyboard navigation and reduced-motion
  preferences.
- Keep components maintainable and styles consistent.

## Quality gate
Before finishing, run the available checks and inspect the actual
rendered pages if browser tooling is available.

Fix visual inconsistencies, overflow, poor contrast, broken layouts
and inactive interactions before declaring the task complete.

Never claim to have visually tested a page unless you actually did.
