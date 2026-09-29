---
target: the main quote flow (app/page.tsx)
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 2
target_identity: "file:C:\\Users\\thunder\\Downloads\\sheet\\frontend\\app\\page.tsx"
target_fingerprint: "sha256:6e168dbaffe0df82c84c499268b8ff13aa943489d52ec8e80e4ebb651916a8ab"
target_path: "C:\\Users\\thunder\\Downloads\\sheet\\frontend\\app\\page.tsx"
timestamp: 2026-09-26T06-36-25Z
slug: frontend-app-page-tsx
---
Method: dual-agent. Browser unavailable to both assessments; Assessment A is source-only.

# Critique: 에덴동산 quote flow (frontend/app/page.tsx)

Score 24/40 (Acceptable). Specificity verdict: interchangeable slate/indigo glass SaaS; brand absent on steps 1-2.

Heuristics: 1=3, 2=3, 3=3, 4=2, 5=2, 6=3, 7=2, 8=3, 9=2, 10=1.

Priority issues:
- [P0] Result screen buries the price behind a min-w-[600px] table (InvoiceTable.tsx:150), exposes internal rows, and does not label the image as a simulation (SimulationPanel.tsx:17-20). Commands: layout, clarify, adapt.
- [P0] All 11 work items preselected (page.tsx:49, :346). Command: harden.
- [P1] Long AI wait is a bare spinner (SimulationPanel.tsx:127-138). Commands: animate, delight.
- [P1] Generic design voice; brand missing from the main flow (globals.css:16-34, layout.tsx:21). Commands: shape, colorize, typeset, bolder.
- [P2] Step 2 packs two jobs; FilmForm accordions all open (page.tsx:516-538, FilmForm.tsx:36). Commands: distill, layout.
- [P2] Accessibility floor: maximumScale 1 (layout.tsx:19), 10-11px slate-400 text, sub-44px targets. Commands: audit, polish.
- [P3] Error copy blames the photo, no retry (page.tsx:605-612, SimulationPanel.tsx:120). Commands: clarify, harden.

Detector: 8 warnings (2 indigo gradients, 1 width transition, 5 gray-on-color that are false positives from disabled:/state variants).
Other: BusinessBanner.tsx:64 short-press dials the owner's own number; blog list shows a public delete control (blog/page.tsx:128-145).
