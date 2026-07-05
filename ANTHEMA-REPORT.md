# Anthena — Reverse Design System Pipeline

## System Report — 2026-07-05

---

## 1. Tổng quan

**Anthena** là hệ thống Reverse Design System Pipeline: capture UI evidence từ ứng dụng nội bộ (Ant Design), phân tích, cluster, và tạo reviewable evidence cho thiết kế hệ thống.

**Repo:** `github.com/tamthanh9701/anthena`

**Latest commit:** `26052a5` (2026-07-05)

**Public API URL:** `https://anthena.jultee.io.vn`

**Deployment:** ZimaOS (Docker) — port 3001

| Service | Container | Port |
|---|---|---|
| API | `reverse-ds-api` | `3001:3000` |
| Crawler | `reverse-ds-crawler` | — |
| Web UI (dev) | `reverse-ds-web-ui-dev` | `5173:5173` |

---

## 2. Kiến trúc hệ thống

```
┌─────────────────────────────────────────────────────────┐
│                    Chrome Extension                      │
│  (MV3, React popup, content-script, service worker)     │
│                                                         │
│  ┌──────────┐  ┌──────────────┐  ┌────────────────┐    │
│  │ Popup UI │→ │ Content-Script│→│ Background SW   │    │
│  │ 360px    │  │ DOM/CSS/Rect │  │ Capture Session │    │
│  │ Run/Env  │  │ AntD Detect  │  │ Upload Client   │    │
│  └──────────┘  └──────┬───────┘  └───────┬────────┘    │
│                        │                  │             │
└────────────────────────┼──────────────────┼─────────────┘
                         │                  │
                    EXTRACT_EVIDENCE    upload multipart
                         │                  │
                         ▼                  ▼
┌─────────────────────────────────────────────────────────┐
│                    Cloudflare Tunnel                     │
│               anthena.jultee.io.vn → 127.0.0.1:3001     │
└────────────────────────────────┬────────────────────────┘
                                 │
┌────────────────────────────────▼────────────────────────┐
│                Backend API (Node.js/Express)             │
│                                                         │
│  ┌──────────┐  ┌──────────────┐  ┌────────────────┐    │
│  │  Auth    │  │ Capture       │  │  Analyzer      │    │
│  │ Middleware│  │ Session API  │  │  ┌──────────┐  │    │
│  │          │  │ POST create  │  │  │Normalizer│  │    │
│  │ admin    │  │ POST upload  │  │  │Clusterer │  │    │
│  │ token    │  │ POST complete│  │  │Scorer    │  │    │
│  │ cap_up-  │  │ GET summary  │  │  │Report    │  │    │
│  │ load_    │  │              │  │  └──────────┘  │    │
│  └──────────┘  └──────────────┘  └────────────────┘    │
│                                                         │
│  ┌──────────┐  ┌──────────────┐                         │
│  │ Collector │  │  DB          │   SQLite (better-sqlite3) │
│  │ Browser   │  │  Index.js    │   Volumes: db-data,     │
│  │ Navigator │  │              │   evidence-store         │
│  │ Screenshot│  │              │                         │
│  └──────────┘  └──────────────┘                         │
└─────────────────────────────────────────────────────────┘
```

---

## 3. Backend API

### Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | None | Service health + DB status |
| `GET` | `/ready` | None | Readiness + DB connected |
| `POST` | `/api/runs` | admin | Create crawl run |
| `GET` | `/api/runs/:id` | admin | Get run details |
| `GET` | `/api/runs/:id/summary` | admin | **Run summary + clusters + findings** |
| `GET` | `/api/runs/:id/clusters` | admin | Clusters list |
| `GET` | `/api/runs/:id/findings` | admin | Findings list |
| `POST` | `/api/capture-sessions` | admin | **Create capture session** → returns `uploadToken`, `uploadUrl` |
| `GET` | `/api/capture-sessions/:id` | admin | Get session status |
| `POST` | `/api/capture-sessions/:id/pages` | `cap_upload_` | **Upload page** (multipart: metadata + snapshot.gz + screenshot) |
| `POST` | `/api/capture-sessions/:id/complete` | admin | **Complete & trigger analysis** |
| `POST` | `/api/capture-sessions/:id/cancel` | admin | Cancel session |
| `POST` | `/api/capture-sessions/:id/retry-page` | admin | Retry failed page |

### State Machine

```
active → uploading → completed → analyzing → ready_for_review
                                                       ↓
                                                    failed (no-data)
```

### Auth

- **Admin token:** constant-time comparison, env `API_TOKEN`
- **Upload token:** `cap_upload_` prefix, SHA-256 hashed in DB, scoped to 1 session
- **Skipped:** `/health`, `/ready`

### Middleware stack

| Middleware | Purpose |
|---|---|
| `requestId.js` | UUID per request |
| `rateLimiter.js` | 100 req/min |
| `auth.js` | Bearer token validation |
| `idempotency.js` | POST idempotency key |
| `errorHandler.js` | Central error formatting |

---

## 4. Chrome Extension (P0-B)

### Architecture

```
┌──────────────────────────────────────────────────┐
│                 Chrome Extension                  │
│                                                  │
│  ┌──────────────────────────────────────────┐    │
│  │ Popup (React, 360px)                     │    │
│  │  ┌──────────┐  ┌───────────┐  ┌───────┐ │    │
│  │  │ RunConfig│→│CaptureBtn│→│Status  │ │    │
│  │  │ API URL  │  │Route Key │  │Uploaded│ │    │
│  │  │ Run ID   │  │📸 Capture│  │Analyzed│ │    │
│  │  │ Token    │  └───────────┘  └───────┘ │    │
│  │  └──────────┘                           │    │
│  └──────────────────────────────────────────┘    │
│                                                    │
│  Content Script (injected on <all_urls>)            │
│  ┌──────────────────────────────────────────┐    │
│  │ dom-extractor   → tagName, id, class    │    │
│  │ css-extractor   → 27 computed props     │    │
│  │ rect-extractor  → absolute position     │    │
│  │ antd-detector   → 55+ AntD components   │    │
│  │ a11y-extractor  → aria roles/labels     │    │
│  └──────────────────────────────────────────┘    │
│                                                    │
│  Service Worker (background)                       │
│  ┌──────────────────────────────────────────┐    │
│  │ capture-session → create + capture       │    │
│  │ upload-client   → multipart gzip upload  │    │
│  │ state persistence in chrome.storage      │    │
│  └──────────────────────────────────────────┘    │
│                                                    │
│  Injected (page-world)                             │
│  ┌──────────────────────────────────────────┐    │
│  │ fiber-extractor  → React fiber tree      │    │
│  │ token-probe      → AntD token variables  │    │
│  └──────────────────────────────────────────┘    │
└──────────────────────────────────────────────────┘
```

### Files

| File | Role |
|---|---|
| `manifest.json` | MV3, activeTab, scripting, all_urls |
| `popup/App.tsx` | Main popup UI |
| `popup/RunSelector.tsx` | API URL / Run ID / Module / Env config |
| `popup/CaptureButton.tsx` | Capture trigger |
| `popup/UploadStatus.tsx` | Capture result display |
| `background/service-worker.js` | Message routing, state |
| `background/capture-session.js` | Create session + capture flow |
| `background/upload-client.js` | Multipart upload + gzip |
| `content/content-script.js` | Message handler |
| `content/dom-extractor.js` | DOM node extraction |
| `content/css-extractor.js` | 27 computed CSS properties |
| `content/rect-extractor.js` | Bounding rects + scroll offset |
| `content/antd-detector.js` | 55 Ant Design classes |
| `content/accessibility-extractor.js` | ARIA roles/labels |
| `injected/page-world-fiber-extractor.js` | React fiber tree |
| `injected/page-world-token-probe.js` | AntD CSS variables |
| `shared/compression.js` | Gzip helpers |
| `shared/schema.js` | Schema versioning |
| `shared/errors.js` | Network/Auth errors |

### Build

```
npm run build → vite + esbuild
dist/ 500.9 kB (popup), service-worker, content-script bundled
```

---

## 5. Analyzer Pipeline

Sau khi session completed:

1. **Normalizer** (`normalizer.js`): parse snapshot → extract nodes → filter visible → flatten
2. **Clusterer** (`clusterer.js`): group nodes by structural similarity → compute centroid
3. **Priority Scorer** (`priority-scorer.js`): score clusters by drift, complexity, coverage
4. **Drift Calculator** (`drift-calculator.js`): compare against Figma tokens (future)
5. **Report Builder** (`report-builder.js`): aggregate into run summary (clusters + findings)

---

## 6. Collector (Playwright, future P0-C)

| Component | File | Purpose |
|---|---|---|
| `browser.js` | Browser pool + Playwright launch | |
| `index.js` | Orchestrator | |
| `login.js` | SSO login automation | |
| `navigator.js` | Route-by-route crawl | |
| `screenshot.js` | Full-page scroll-stitch | |

---

## 7. Deployment (ZimaOS)

### Docker stack

| Volume | Path | Purpose |
|---|---|---|
| `evidence-store` | `/data/evidence` | Screenshots, snapshots |
| `db-data` | `/data/db` | SQLite database |
| `config-data` | `/data/config` | Environment config |

### Cloudflare Tunnel

```
Tunnel ID: 69cc50b6-f138-4988-802a-dddb0043cbaf
Config:    /DATA/anthena/infra/cloudflare/config.yml
Domain:    anthena.jultee.io.vn → 127.0.0.1:3001
Connections: 4 QUIC (HKG)
Runtime:  /DATA/anthena/bin/cloudflared (v2026.6.1)
```

---

## 8. Git History (42 commits)

```
26052a5  fix: https protocol in e2e test
b891bfc  fix: default API URL localhost:3001
97b7a25  fix: Docker storage check
815a29c  test: p0a e2e 29 passed
b57afde  fix: findings rank NOT NULL
6364a98  fix: no-data guard
9e1c9be  fix: complete + analyze + ready_for_review
45a331b  fix: 3 blockers (upload, complete, no-data)
758b2ad  fix: auth + CORS + extension build + state transitions
b39e250  fix: auth accept cap_upload_token + CORS
...
79a1e18  feat: P0-C full-page scroll-stitch (partial)
c416cdb  feat: P0-B Chrome Extension MVP
152a097  feat: P0-A Capture Session API + DB migration
82a0be1  Initial commit
```

---

## 9. Test Coverage

### P0-A E2E (29 pass, 0 fail)

```
Health:  200
Ready:   DB connected
Upload:  201 (cap_upload_ token)
Complete: 202
Poll:    ready_for_review (1 giây)
Clusters: 16-18 via /api/runs/:runId/summary
Findings: 1-10
Negatives: admin upload → 403, empty session → failed
Environments: local HTTP + ZimaOS internal + Cloudflare HTTPS
```

---

## 10. P0-B Chưa hoàn tất

Phiên bản extension chưa được test manual trên route nội bộ thật do chưa load được extension (đang chờ user load từ `extension/dist`).

---

## 11. Roadmap (P0 priority)

| Phase | Trạng thái | Mô tả |
|---|---|---|
| **P0-A** | ✅ PASS | Backend ingestion gate: create run/session, upload, analyze, ready_for_review |
| **P0-A Cloudflare** | ✅ PASS | Public HTTPS e2e via anthena.jultee.io.vn |
| **P0-B** | 🔶 BUILD | Chrome Extension MVP — viewport capture, DOM/CSS/Rect/AntD extract, upload |
| **P0-B manual** | ⏳ PENDING | Chờ user load extension + capture 1 route nội bộ thật |
| **P0-C** | 🟡 PARTIAL | Full-page scroll-stitch code có sẵn, chưa tích hợp extension |
| **P0-D** | ⏳ PENDING | Governance / delta tracking |
| **Figma** | ⏳ PENDING | Figma Variables sync, component inventory |
| **MCP/Plugin** | ⏳ PENDING | Cursor/Cline MCP server |
| **Dashboard** | ⏳ PENDING | Web UI expansion |

---

## 12. Key decisions

| Decision | Rationale |
|---|---|
| SQLite | Zero ops, single binary, fits small team scale |
| Express | Familiar, simple middleware pattern |
| Chrome Extension | Native tab access + screenshot API |
| Cloudflare Tunnel | No public IP needed for ZimaOS |
| Docker volumes | Storage separation for DB + evidence |
| `cap_upload_` scoped tokens | Admin token không expose cho upload path |
| Viewport-only screenshot | P0-B scope; scroll-stitch deferred |