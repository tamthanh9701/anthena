# Success Metrics — Vertial Slice 1

## Round-trip integrity
- [ ] DOM graph with stable node IDs extends from extension capture to Postgres
- [ ] Computed CSS properties (≥1 style per element) in EvidencePackage
- [ ] Accessibility tree (role, name, state) in EvidencePackage
- [ ] Rect/screenshot offset ≤2 CSS px
- [ ] Signal status (computedCss, accessibility) reflects real data presence

## Mapping precision
- [ ] AntD identification precision ≥90% on labelled fixtures (v4/v5/v6)
- [ ] Theme override detected and preserved
- [ ] Portal/modal boundary handled

## Redaction
- [ ] Input values absent from uploaded payload
- [ ] Configurable selectors blurred in screenshots

## Figma idempotency
- [ ] Plugin maps to correct owned clone IDs
- [ ] Preview diff shows correct before/after
- [ ] Apply is idempotent (same release applied twice = no duplicate)
- [ ] Manual edits in Figma are preserved on reapply (conflict detection)

## Build & test
- [ ] Backend: 235/235 tests pass (vitest)
- [ ] Web UI: tsc --noEmit && vite build pass
- [ ] Extension: npm run build pass
- [ ] Real-package E2E: extension install → capture → upload → analyze → review → Figma

## Performance (NFR)
- [ ] Capture chunk upload under 10s for typical page
- [ ] Analysis under 5s per snapshot
- [ ] Figma sync under 30s per release
