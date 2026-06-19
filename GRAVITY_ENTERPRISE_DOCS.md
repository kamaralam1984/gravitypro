## PART V — STANDARDS, STRATEGY, COMPLIANCE & REFERENCE

---

### 65. Source Code Standards

#### 65.1 ESLint Configuration

```json
// .eslintrc.js (root)
{
  "root": true,
  "parser": "@typescript-eslint/parser",
  "parserOptions": {
    "project": "./tsconfig.json",
    "ecmaVersion": 2022,
    "sourceType": "module"
  },
  "plugins": ["@typescript-eslint", "import", "node"],
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:@typescript-eslint/recommended-requiring-type-checking",
    "plugin:import/recommended",
    "plugin:import/typescript"
  ],
  "rules": {
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/no-unsafe-assignment": "error",
    "@typescript-eslint/no-unsafe-call": "error",
    "@typescript-eslint/no-unsafe-member-access": "error",
    "@typescript-eslint/no-unsafe-return": "error",
    "@typescript-eslint/explicit-function-return-type": "warn",
    "@typescript-eslint/no-floating-promises": "error",
    "@typescript-eslint/await-thenable": "error",
    "no-console": "error",
    "import/order": ["error", { "alphabetize": { "order": "asc" } }],
    "import/no-cycle": "error",
    "eqeqeq": ["error", "always"]
  }
}
```

#### 65.2 Prettier Configuration

```json
// .prettierrc
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false,
  "arrowParens": "always",
  "endOfLine": "lf"
}
```

#### 65.3 Naming Conventions

| Construct | Convention | Example |
|---|---|---|
| Files (TS/JS) | kebab-case | `location-service.ts` |
| React components | PascalCase file + export | `MapScreen.tsx` |
| Variables / functions | camelCase | `getUserById` |
| Constants (module-level) | SCREAMING_SNAKE | `MAX_RETRY_COUNT` |
| Types / Interfaces | PascalCase, prefix `I` for interfaces | `IUserPayload`, `LocationRow` |
| Database tables | snake_case | `location_events` |
| Database columns | snake_case | `created_at` |
| Env vars | SCREAMING_SNAKE | `DATABASE_URL` |
| CSS / Tailwind classes | kebab-case | `text-brand-green` |

#### 65.4 Comment Policy

- **JSDoc** required on all exported functions, classes, and types.
- Inline comments explain *why*, not *what*.
- No commented-out code may be committed; use feature flags or branches.
- TODO comments require a linked ticket: `// TODO(GRV-123): remove after migration`.

#### 65.5 TypeScript `no-any` Enforcement

All `any` usages are compile-time errors via ESLint. Acceptable escape hatches:

```typescript
// Approved pattern — narrow unknown at boundary
function parseWebhook(raw: unknown): WebhookPayload {
  return webhookSchema.parse(raw); // Zod narrows to typed output
}

// Approved pattern — third-party type gap
const lib = require('legacy-lib') as LegacyLib;

// NEVER acceptable
const data: any = response.data; // ❌ ESLint error
```

---

### 66. Coding Guidelines

#### 66.1 Async/Await Over Callbacks

All asynchronous code MUST use `async/await`. Callback-style APIs must be promisified at the adapter layer before use in business logic.

```typescript
// ✅ Correct
const user = await db.query<UserRow>('SELECT * FROM users WHERE id = $1', [id]);

// ❌ Forbidden
db.query('SELECT ...', (err, result) => { ... });
```

#### 66.2 Parameterized Queries

No string interpolation in SQL. All user-supplied values via `$N` placeholders.

```typescript
// ✅ Safe
await pool.query('DELETE FROM sessions WHERE user_id = $1 AND id = $2', [userId, sessionId]);

// ❌ SQL injection vector — immediate PR rejection
await pool.query(`DELETE FROM sessions WHERE user_id = ${userId}`);
```

#### 66.3 Zod Validation at All HTTP Boundaries

Every route handler validates its input schema before processing:

```typescript
const createGroupSchema = z.object({
  name: z.string().min(1).max(64),
  memberIds: z.array(z.string().uuid()).max(20),
});

router.post('/groups', authenticate, async (req, res) => {
  const body = createGroupSchema.parse(req.body); // throws ZodError → 400
  // ... safe to use body.name, body.memberIds
});
```

#### 66.4 Error Propagation

- Route handlers must not swallow errors; rethrow or pass to `next(err)`.
- Domain errors (not found, forbidden) use typed `AppError` subclasses.
- Never expose raw stack traces in production JSON responses.

```typescript
class AppError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

class NotFoundError extends AppError {
  constructor(resource: string) {
    super(404, `${resource} not found`);
  }
}
```

#### 66.5 No `console.log` in Production Code

Use the structured `logger` instance (Pino) exclusively:

```typescript
import { logger } from '../lib/logger';

logger.info({ userId, action: 'location_update' }, 'Location stored');
logger.error({ err, userId }, 'Failed to process geofence');
```

`console.log` / `console.error` usage will fail the CI lint gate.

---

### 67. API Versioning Policy

#### 67.1 Current Version

All endpoints are prefixed `/api/v1/`. Version `v1` is the current stable version.

#### 67.2 URI Path Versioning

Gravity uses URI path versioning (not header-based or query-param-based) for explicit, cacheable, debuggable version control.

```
GET /api/v1/users/me
GET /api/v2/users/me   ← future breaking version
```

#### 67.3 Backward Compatibility Rules

Within a version (`v1`):

- **MUST NOT** remove existing response fields.
- **MUST NOT** change field types.
- **MUST NOT** change HTTP methods or status codes for existing endpoints.
- **MAY** add new optional request fields (ignored by old clients).
- **MAY** add new response fields (ignored by old clients).

#### 67.4 Deprecation Process

| Step | Action | Timeline |
|---|---|---|
| 1 | Add `Deprecation: true` and `Sunset: <date>` response headers | Immediately on deprecation |
| 2 | Announce in developer changelog | Week 0 |
| 3 | Add in-app SDK warning log | Week 0 |
| 4 | Email registered API consumers | Week 2 |
| 5 | Return HTTP 410 Gone | After sunset date |

#### 67.5 Changelog Table

| Version | Date | Type | Description |
|---|---|---|---|
| v1.0.0 | 2025-01-15 | Initial | Core auth, groups, location endpoints |
| v1.1.0 | 2025-03-01 | Feature | Geofence CRUD endpoints added |
| v1.2.0 | 2025-05-01 | Feature | SOS alert endpoint added |
| v1.2.1 | 2025-06-01 | Fix | Correct 401 vs 403 status codes |
| v1.3.0 | 2025-09-01 | Feature | Batch location history endpoint |

---

### 68. Release Management Process

#### 68.1 Semantic Versioning

Gravity follows [SemVer 2.0.0](https://semver.org/): `MAJOR.MINOR.PATCH`.

- **MAJOR**: Breaking API or data schema change requiring client update.
- **MINOR**: Backward-compatible new features.
- **PATCH**: Bug fixes, security patches, performance improvements.

#### 68.2 Release Checklist

```
PRE-RELEASE
  [ ] All CI checks green on release branch
  [ ] Security scan (npm audit, Snyk) — zero high/critical issues
  [ ] Database migration scripts reviewed and tested on staging
  [ ] Load test run on staging — p99 < 500ms
  [ ] CHANGELOG.md updated
  [ ] Version bumped in package.json, app.json
  [ ] Tag created: git tag -a v1.3.0 -m "Release v1.3.0"

DEPLOYMENT
  [ ] Deploy to staging — smoke test
  [ ] Blue/green swap to production (Caddy upstream switch)
  [ ] Monitor error rate for 15 minutes post-deploy
  [ ] Monitor p99 latency for 15 minutes post-deploy

POST-RELEASE
  [ ] Merge release branch back to main
  [ ] GitHub Release created with changelog
  [ ] Notify stakeholders via Slack #releases
  [ ] App Store / Play Store build submitted (if mobile version changed)
```

#### 68.3 Changelog Format

```markdown
## [1.3.0] — 2025-09-01
### Added
- Batch location history endpoint (`GET /api/v1/locations/history/batch`)
- Export to GPX format for trip history

### Changed
- Improved geofence evaluation performance (PostGIS index optimization)

### Fixed
- SSE connection dropping after exactly 60 s on Cloudflare proxied routes

### Security
- Upgraded jsonwebtoken 9.0.1 → 9.0.2 (CVE-2024-XXXXX)
```

#### 68.4 Hotfix Flow

```
main
  └─ hotfix/grv-231-sse-disconnect
       └─ fix committed
       └─ tested on staging
       └─ merged to main
       └─ tagged v1.2.2
       └─ CHANGELOG updated
```

#### 68.5 Rollback Procedure

1. Caddy upstream switched back to previous PM2 cluster (`pm2 reload gravity-api --update-env`).
2. If database migration was applied: run `down` migration script.
3. Tag previous release as `rollback-active`.
4. Post-mortem scheduled within 48 hours.

---

### 69. Risk Assessment Matrix

| ID | Risk | Probability | Impact | Severity | Mitigation | Owner |
|---|---|---|---|---|---|---|
| R01 | Neon cold-start latency spike under traffic | Medium | High | High | Connection pooler + keep-alive queries | Backend Lead |
| R02 | SSE connection limit per server | High | Medium | High | Horizontal scaling + load balancer sticky sessions | DevOps |
| R03 | Expo SDK breaking change | Medium | High | High | Pin SDK version; test upgrades in staging branch | Mobile Lead |
| R04 | Cloudflare R2 outage | Low | Medium | Medium | Fallback to local storage + async retry queue | Backend Lead |
| R05 | JWT secret compromise | Low | Critical | Critical | Secret rotation procedure; short expiry (15 min access) | Security Lead |
| R06 | PostGIS query timeout on large geofence sets | Medium | Medium | Medium | Index optimization; limit geofences per user (max 50) | Backend Lead |
| R07 | Background location denied by OS update | High | High | Critical | Graceful degradation; prompt re-permission flow | Mobile Lead |
| R08 | GDPR data deletion request at scale | Low | High | Medium | Automated deletion pipeline; 30-day SLA | Compliance |
| R09 | Play Store policy change on location tracking | Medium | Critical | Critical | Policy monitoring; enterprise MDM distribution fallback | Product |
| R10 | Third-party push notification delivery failure | Medium | High | High | Retry with exponential backoff; fallback SMS (Phase 2) | Backend Lead |
| R11 | Database schema migration failure in production | Low | Critical | Critical | Tested rollback scripts; maintenance window deployments | DevOps |
| R12 | Node.js memory leak in SSE handler | Medium | High | High | PM2 memory limit + auto-restart; heap profiling in staging | Backend Lead |
| R13 | DDoS attack on API endpoints | Medium | High | High | Cloudflare DDoS protection; rate limiting; WAF rules | DevOps |
| R14 | Insider threat — admin data export | Low | Critical | High | RBAC; audit log; anomaly detection on bulk queries | Security Lead |
| R15 | Incorrect geofence alert (false positive storm) | Medium | High | High | Debounce geofence events (5-minute cooldown per fence) | Backend Lead |
| R16 | App store review rejection | Medium | Medium | Medium | Pre-submission compliance review; privacy manifest | Mobile Lead |
| R17 | Key team member departure | Medium | High | High | Documentation-first culture; pair programming | Engineering Manager |
| R18 | Regulatory change (DPDP Act enforcement) | Medium | High | High | Legal retainer; compliance review quarterly | Compliance |

---

### 70. Future Roadmap

#### 70.1 Roadmap Gantt

```mermaid
gantt
  title Gravity Platform Roadmap
  dateFormat YYYY-MM
  axisFormat %b %Y

  section Phase 1 — MVP
    Core auth & groups        :done, p1a, 2025-01, 2025-03
    Real-time location SSE    :done, p1b, 2025-02, 2025-04
    Geofencing v1             :done, p1c, 2025-03, 2025-05
    Mobile app (Expo)         :done, p1d, 2025-02, 2025-06

  section Phase 2 — Scale
    BullMQ + Redis            :active, p2a, 2025-07, 2025-09
    WebSocket upgrade         :p2b, 2025-08, 2025-10
    Horizontal scaling        :p2c, 2025-09, 2025-11
    Enterprise SSO (SAML)     :p2d, 2025-10, 2026-01

  section Phase 3 — Intelligence
    ML trip detection         :p3a, 2026-01, 2026-04
    Predictive ETA            :p3b, 2026-02, 2026-05
    Anomaly detection         :p3c, 2026-03, 2026-06
    AI safety score           :p3d, 2026-04, 2026-07

  section Phase 4 — Platform
    B2B fleet management      :p4a, 2026-06, 2026-12
    White-label SDK           :p4b, 2026-08, 2027-02
    Marketplace integrations  :p4c, 2026-10, 2027-03
    IPO readiness             :p4d, 2027-01, 2027-12
```

#### 70.2 Year-by-Year Milestones

| Year | Focus | Key Deliverables |
|---|---|---|
| 2025 | MVP Launch | Core tracking, geofencing, mobile app, 10K MAU target |
| 2026 | Scale & Enterprise | WebSocket migration, SSO, B2B pilot, 100K MAU target |
| 2027 | Intelligence | ML features, predictive ETA, 500K MAU target |
| 2028 | Platform | White-label SDK, fleet management, 2M MAU target |
| 2029 | Global | Multi-region deployment, compliance expansion, Series B |

---

### 71. Cost Estimation

#### 71.1 Monthly Infrastructure Cost by Tier

| Service | Hobby (0–1K users) | Startup (1K–10K) | Growth (10K–100K) | Enterprise (100K+) |
|---|---|---|---|---|
| Neon PostgreSQL | $0 (free tier) | $19/mo | $69/mo | $700+/mo |
| VPS / Compute | $6/mo (Hetzner CX11) | $20/mo (CX21) | $80/mo (CX41) | $400+/mo (dedicated) |
| Cloudflare R2 | $0 (<10 GB) | $5/mo | $25/mo | $150+/mo |
| Expo EAS Build | $0 (free tier) | $29/mo | $99/mo | $499/mo |
| Redis (Upstash) | $0 | $10/mo | $40/mo | $200+/mo |
| Push Notifications | $0 (Expo free) | $0 | $0 | $0 |
| Monitoring (Grafana) | $0 (self-hosted) | $0 | $29/mo (Cloud) | $299/mo |
| Backups (S3/R2) | $1/mo | $5/mo | $20/mo | $100/mo |
| **Total (est.)** | **~$7/mo** | **~$88/mo** | **~$362/mo** | **~$2,348+/mo** |

#### 71.2 Break-Even Analysis

| Scenario | MRR Needed | Users @ $4.99/mo | Users @ $9.99/mo |
|---|---|---|---|
| Hobby (self-sustaining) | $7 | 2 users | 1 user |
| Startup tier | $88 | 18 users | 9 users |
| Growth tier | $362 | 73 users | 37 users |
| Enterprise tier | $2,348 | 470 users | 235 users |

Break-even at 100K users (Growth tier, $362/mo cost) with 0.073% conversion to paid — extremely achievable.

---

### 72. Cloud Infrastructure Cost Breakdown

#### 72.1 Per-Service Cost Table

| Component | Provider | Hobby | Startup | Growth | Enterprise | Notes |
|---|---|---|---|---|---|---|
| Database (primary) | Neon | Free | $19 | $69 | $700 | Serverless auto-scale |
| Database (read replica) | Neon | — | — | $29 | $350 | Added at Growth |
| Object Storage | Cloudflare R2 | Free | $5 | $25 | $150 | No egress fees |
| Compute (API) | Hetzner | $6 | $20 | $80 | $400 | VPS, EU datacenter |
| Compute (worker) | Hetzner | — | — | $40 | $200 | BullMQ workers |
| Load Balancer | Hetzner | — | — | $6 | $20 | Added at Growth |
| Cache (Redis) | Upstash | Free | $10 | $40 | $200 | Serverless Redis |
| CDN | Cloudflare | Free | Free | Free | $200 | Pro plan at Enterprise |
| Build (EAS) | Expo | Free | $29 | $99 | $499 | Mobile CI builds |
| Monitoring | Self-hosted | $0 | $0 | $29 | $299 | Grafana Cloud |
| Logging | Self-hosted Loki | $0 | $0 | $20 | $100 | Grafana Loki |
| Email (transactional) | Resend | Free | $20 | $20 | $90 | Email alerts |
| SMS (Phase 2) | Twilio | — | — | $50 | $500 | SOS alerts |

---

### 73. Competitive Analysis

#### 73.1 Feature Matrix

| Feature | Gravity | Life360 | GeoZilla | Google Family Sharing |
|---|---|---|---|---|
| Real-time location | ✅ (SSE, <3s) | ✅ | ✅ | ✅ |
| Background tracking | ✅ | ✅ | ✅ | ✅ |
| Geofencing | ✅ (PostGIS) | ✅ | ✅ | Limited |
| SOS alert | ✅ | ✅ | ✅ | ❌ |
| Location history | ✅ (30 days) | ✅ (Platinum) | ✅ | Limited |
| Open source / self-host | ✅ (Traccar) | ❌ | ❌ | ❌ |
| No egress fees | ✅ (R2) | N/A | N/A | N/A |
| GDPR compliance | ✅ | Partial | Partial | ✅ |
| DPDP Act ready | ✅ | ❌ | ❌ | Partial |
| B2B / fleet | Roadmap | ✅ (paid) | ❌ | ❌ |
| Offline queue | ✅ | Limited | Limited | ❌ |
| Enterprise SSO | Roadmap | Enterprise plan | ❌ | Google Workspace |
| White-label | Roadmap | ❌ | ❌ | ❌ |
| Free tier | ✅ | Limited | ✅ | ✅ |
| Pricing | $4.99–$9.99/mo | $7.99–$15.99/mo | $2.99–$5.99/mo | Free |

#### 73.2 Gravity Differentiators

1. **Privacy-first architecture** — user data never sold; GDPR + DPDP compliant by design.
2. **PostGIS server-side geofencing** — sub-100ms evaluation vs. client-side approximations.
3. **Cost efficiency** — Cloudflare R2 zero-egress model; 40% lower infrastructure cost at scale vs. S3-based competitors.
4. **Open-source GPS layer** — Traccar integration gives enterprise customers self-hosting option.
5. **India-first compliance** — DPDP Act 2023 ready; competitors lag.
6. **Developer-friendly API** — fully versioned REST API with Zod-validated schemas; public documentation.

---

### 74. System Strengths and Weaknesses

#### 74.1 SWOT Analysis

**Strengths (S1–S10)**

| ID | Strength |
|---|---|
| S1 | Modern TypeScript stack end-to-end — reduced type errors, better IDE support |
| S2 | PostGIS for geofencing — industry-standard spatial queries, highly accurate |
| S3 | Cloudflare R2 storage — zero egress fees, cost advantage at scale |
| S4 | Expo managed workflow — rapid mobile iteration, OTA updates |
| S5 | SSE real-time — lower server overhead than WebSockets for unidirectional streams |
| S6 | Neon serverless PostgreSQL — auto-scale, no DBA required at MVP stage |
| S7 | PM2 cluster mode — zero-downtime reloads, built-in process supervision |
| S8 | Zod validation everywhere — runtime safety at all HTTP boundaries |
| S9 | GDPR/DPDP dual compliance — competitive advantage in regulated markets |
| S10 | Traccar open-source GPS — auditable, self-hostable, enterprise-grade GPS layer |

**Weaknesses (W1–W10)**

| ID | Weakness |
|---|---|
| W1 | SSE unidirectional — server-to-client only; client commands still need polling fallback |
| W2 | Neon cold-start latency — serverless DB can add 200–800ms on first query after idle |
| W3 | No WebSocket support yet — limits bidirectional real-time features (Phase 2 gap) |
| W4 | Single-region deployment — no geographic failover for MVP |
| W5 | Background location battery drain — iOS background mode restrictions limit accuracy |
| W6 | PM2 not Kubernetes-native — limits cloud-native auto-scaling |
| W7 | No multi-tenancy isolation — shared DB schema, not schema-per-tenant |
| W8 | Limited observability tooling — no distributed tracing (OpenTelemetry not yet integrated) |
| W9 | Manual release process — no fully automated blue/green deployment pipeline |
| W10 | Small team — bus factor risk on critical subsystems |

**Opportunities (O1–O10)**

| ID | Opportunity |
|---|---|
| O1 | DPDP Act enforcement in India — creates urgency for compliant alternatives |
| O2 | B2B fleet management market — underserved SMB segment |
| O3 | Elder care vertical — growing market for family monitoring solutions |
| O4 | School safety integrations — district-level contracts |
| O5 | White-label licensing — recurring revenue with low marginal cost |
| O6 | Wearable integration — Apple Watch / Wear OS location reporting |
| O7 | Emergency services integration — tie-in with local 112/911 services |
| O8 | Travel safety sector — international location monitoring |
| O9 | AI/ML trip intelligence — premium feature differentiation |
| O10 | Open-source community contribution — Traccar plugins, developer ecosystem |

**Threats (T1–T10)**

| ID | Threat |
|---|---|
| T1 | Life360 price competition — well-funded incumbent |
| T2 | Google Family Sharing free tier — difficult to compete with free |
| T3 | iOS background location restrictions tightening — WWDC policy changes |
| T4 | Play Store policy changes — location app category restrictions |
| T5 | GDPR enforcement action — fines up to 4% global revenue |
| T6 | Data breach reputational risk — location data is highly sensitive |
| T7 | Neon pricing changes — vendor dependency risk |
| T8 | Cloudflare policy changes — CDN/R2 vendor lock-in |
| T9 | Competitor feature parity — geofencing commoditization |
| T10 | Economic downturn — consumer subscription churn |

---

### 75. Enterprise Readiness Assessment

#### 75.1 Readiness Scores by Category

| Category | Score (/10) | Notes |
|---|---|---|
| Security Architecture | 6/10 | JWT auth solid; MFA, WAF, secrets rotation needed |
| Scalability | 5/10 | PM2 cluster works; horizontal scaling, Redis queue in Phase 2 |
| Observability | 5/10 | Prometheus + Grafana set up; distributed tracing missing |
| Compliance | 7/10 | GDPR + DPDP framework in place; formal audit pending |
| Documentation | 8/10 | Comprehensive technical docs; API docs need OpenAPI spec |
| Testing Coverage | 4/10 | Unit tests exist; E2E test suite in progress |
| Disaster Recovery | 4/10 | Manual backups; RTO/RPO not formally tested |
| High Availability | 4/10 | Single server; no active-active failover |
| CI/CD Maturity | 5/10 | GitHub Actions in place; manual deploy steps remain |
| Support Readiness | 3/10 | No helpdesk system; no SLA formally defined |
| Data Governance | 6/10 | Deletion pipeline designed; retention policy documented |
| **Overall** | **5.3/10** | **Pre-enterprise; 12–18 months to enterprise-grade** |

---

### 76. Security Audit Checklist

#### 76.1 Authentication Security

```
[ ] Passwords hashed with bcryptjs, cost factor 12+
[ ] JWT access tokens expire in 15 minutes
[ ] JWT refresh tokens expire in 30 days
[ ] Refresh token rotation on every use (old token invalidated)
[ ] Refresh tokens stored in HttpOnly cookie (web) / SecureStore (mobile)
[ ] Account lockout after 5 failed login attempts (15-minute lockout)
[ ] Password reset tokens are single-use and expire in 1 hour
[ ] No sensitive data in JWT payload (no passwords, no card numbers)
[ ] MFA support planned (Phase 2 — TOTP via expo-otp)
[ ] OAuth2 social login providers validated on server side
```

#### 76.2 API Security

```
[ ] All endpoints require authentication (explicit allowlist for public routes)
[ ] Authorization checked on every resource access (not just authentication)
[ ] Rate limiting on all auth endpoints (5 req/15min per IP)
[ ] Rate limiting on all API endpoints (100 req/min per user)
[ ] Input validation via Zod on all POST/PUT/PATCH bodies
[ ] Query parameter validation on all GET endpoints
[ ] File upload type validation + size limits (max 5 MB, allowlist MIME types)
[ ] CORS configured with explicit origin allowlist (no wildcard in production)
[ ] Security headers via Helmet.js (CSP, HSTS, X-Frame-Options, etc.)
[ ] No sensitive data in URL query parameters (use body or headers)
[ ] API versioning in place (URI path versioning)
[ ] Deprecation headers set on sunset endpoints
```

#### 76.3 Data Security

```
[ ] All data encrypted in transit (TLS 1.2+, enforced by Caddy)
[ ] Database connections encrypted (SSL mode required)
[ ] PII fields identified and documented
[ ] Location data retained for maximum 90 days (configurable)
[ ] Soft delete implemented (no hard PII deletion until GDPR request)
[ ] GDPR deletion pipeline tested end-to-end
[ ] Database backups encrypted at rest
[ ] R2 object storage encryption enabled (AES-256)
[ ] No PII in logs (log scrubbing middleware in place)
[ ] No PII in error messages returned to clients
[ ] Database connection string never logged
[ ] JWT secrets not committed to version control
```

#### 76.4 Infrastructure Security

```
[ ] SSH key-only access to production server (password auth disabled)
[ ] UFW firewall: only ports 22, 80, 443 exposed publicly
[ ] Caddy automatic TLS (Let's Encrypt) — no manual cert management
[ ] PM2 runs under non-root user account
[ ] Node.js process does not run as root
[ ] Production env vars in .env file (not in source code)
[ ] .env excluded from git via .gitignore
[ ] Secrets in CI/CD via GitHub Actions Secrets (not env files)
[ ] Server OS auto-security-updates enabled (unattended-upgrades)
[ ] Fail2ban configured for SSH brute-force protection
[ ] Cloudflare DDoS protection enabled (proxy mode)
[ ] No unused ports open (nmap scan clean)
```

#### 76.5 Code Security

```
[ ] npm audit run in CI — zero high/critical vulnerabilities to pass
[ ] Snyk scan integrated in CI (or equivalent SCA tool)
[ ] No eval() usage in codebase
[ ] No dynamic require() with user-controlled paths
[ ] All SQL queries use parameterized statements
[ ] No shell command injection (child_process with user data forbidden)
[ ] Third-party dependencies reviewed before addition (license + security)
[ ] Dependency lockfile (package-lock.json) committed and enforced in CI
[ ] ESLint security rules enabled (eslint-plugin-security)
[ ] No hardcoded credentials in source code (gitleaks scan in CI)
```

#### 76.6 Operational Security

```
[ ] Audit log for all admin actions (user data access, exports)
[ ] Structured logging — no free-text log injection vectors
[ ] Alerting on anomalous query patterns (bulk exports, >1000 rows)
[ ] Incident response playbook documented
[ ] Security contact published (security@trackalways.com)
[ ] Responsible disclosure policy published
[ ] Penetration test scheduled (pre-launch, annual)
[ ] Security review on every PR touching auth or data access layers
[ ] Access review quarterly (who has production access)
[ ] Employee offboarding checklist includes production access revocation
```

---

### 77. Production Readiness Checklist

#### 77.1 Infrastructure

```
[ ] VPS provisioned and hardened (SSH, UFW, fail2ban)
[ ] Caddy installed and serving HTTPS with valid Let's Encrypt certificate
[ ] PM2 installed, ecosystem.config.js configured, startup script set
[ ] PostgreSQL (Neon) connection verified from production server
[ ] Redis (Upstash) connection verified from production server
[ ] Cloudflare R2 bucket created, credentials configured
[ ] Environment variables set in .env.production
[ ] DNS records pointing to production server IP
[ ] Cloudflare proxy mode enabled for DDoS protection
```

#### 77.2 Security

```
[ ] All checklist items in Section 76 passed
[ ] HTTPS enforced (Caddy redirect HTTP → HTTPS)
[ ] HSTS header set (min-age 1 year)
[ ] Security headers verified via securityheaders.com
[ ] JWT secret is 256-bit random value (not default)
[ ] bcrypt cost factor verified = 12 in production config
[ ] Rate limiter tested under load (returns 429 correctly)
```

#### 77.3 Monitoring

```
[ ] Prometheus metrics endpoint active (/metrics, internal-only)
[ ] Grafana dashboards configured (API latency, error rate, active users)
[ ] Uptime monitor configured (UptimeRobot or Better Stack)
[ ] Alerting rules set: p99 > 2s, error rate > 1%, disk > 80%
[ ] PM2 log rotation configured (max 10 MB per log file, 7-day retention)
[ ] Server disk space alert at 80% threshold
```

#### 77.4 Performance

```
[ ] k6 load test run against production-equivalent staging
[ ] p99 latency < 500ms for all core API endpoints under expected load
[ ] Database indexes verified for all common query patterns
[ ] PostGIS spatial index on location_events(geom) confirmed
[ ] Connection pool size tuned (max 20 per PM2 instance)
[ ] PM2 instances = CPU core count
[ ] Gzip compression enabled in Caddy for API responses
```

#### 77.5 Data & Backup

```
[ ] Automated Neon database backup confirmed (Neon auto-backup enabled)
[ ] Manual backup script tested and scheduled (pg_dump weekly)
[ ] R2 lifecycle policy configured (delete objects older than 365 days)
[ ] Data retention policy enforced by cron job
[ ] GDPR deletion endpoint tested end-to-end
[ ] Restore from backup tested (RTO measured)
```

#### 77.6 Documentation & Legal

```
[ ] Privacy Policy published and accessible from app
[ ] Terms of Service published and accessible from app
[ ] Cookie policy if web app uses cookies
[ ] GDPR Data Processing Agreement template ready for enterprise clients
[ ] DPO contact published (privacy@trackalways.com)
[ ] App store privacy nutrition labels completed (iOS) / data safety form (Android)
```

#### 77.7 Mobile App

```
[ ] Expo production build created via EAS Build
[ ] App signed with production certificates (iOS Distribution, Android Keystore)
[ ] App store metadata complete (screenshots, description, keywords)
[ ] Location permission usage descriptions in Info.plist / AndroidManifest.xml
[ ] Background modes declared correctly (iOS: location, fetch)
[ ] OTA update compatibility tested (Expo Updates)
[ ] App rating prompts implemented (after positive interactions)
[ ] Crash reporting integrated (Sentry or Expo Diagnostics)
```

#### 77.8 Support

```
[ ] Support email configured (support@trackalways.com)
[ ] In-app feedback mechanism implemented
[ ] FAQ / Help Center page live
[ ] App store review responses process defined
[ ] Escalation path for data breach documented (72-hour GDPR notification)
```

---

### 78. Architecture Decision Records

#### ADR-001: Express vs Fastify

- **Date**: 2025-01-10
- **Status**: Accepted
- **Decision**: Use Express 5.2.x
- **Context**: Node.js web framework selection for the REST API layer.
- **Options Considered**: Express 5, Fastify 4, Koa 2, Hono
- **Decision Rationale**: Express has the largest ecosystem, most middleware compatibility, and the team has existing expertise. Express 5 adds native async error handling. Fastify's 10–15% throughput advantage is not meaningful at MVP scale. Koa lacks ecosystem breadth.
- **Consequences**: Standard Express patterns apply. Performance headroom exists; Fastify migration is possible at Phase 3 if benchmarks demand it.

---

#### ADR-002: SSE vs WebSocket for Real-Time Location

- **Date**: 2025-01-15
- **Status**: Accepted
- **Decision**: Use Server-Sent Events (SSE)
- **Context**: Real-time location updates are server-to-client unidirectional (server pushes new coordinates to clients).
- **Options Considered**: WebSocket, SSE, Long-polling, HTTP/2 Push
- **Decision Rationale**: SSE is native HTTP (works through proxies, Cloudflare, and load balancers without special configuration). No bidirectional requirement at Phase 1. SSE auto-reconnects natively. WebSocket requires separate upgrade handling and sticky sessions in load-balanced environments.
- **Consequences**: Client-to-server commands (e.g., SOS) use normal REST POST. WebSocket migration planned for Phase 2 when bidirectional features (chat, real-time group commands) are added.

---

#### ADR-003: Neon Serverless vs Self-Hosted PostgreSQL

- **Date**: 2025-01-10
- **Status**: Accepted
- **Decision**: Use Neon serverless PostgreSQL
- **Context**: Database hosting selection for MVP.
- **Options Considered**: Neon (serverless), Supabase, Railway PostgreSQL, Self-hosted on VPS, AWS RDS
- **Decision Rationale**: Neon's branching feature enables per-PR database branches for CI testing. Auto-scaling eliminates capacity planning. Free tier supports MVP. PostGIS extension available. Self-hosting requires DBA overhead the small team cannot sustain.
- **Consequences**: Cold-start latency (200–800ms) after idle periods is acceptable at MVP scale. Connection pooler (PgBouncer-compatible) required. Migration to self-hosted possible if Neon costs become prohibitive.

---

#### ADR-004: Expo Managed Workflow vs Bare React Native

- **Date**: 2025-01-12
- **Status**: Accepted
- **Decision**: Use Expo managed workflow with EAS Build
- **Context**: Mobile app development framework selection.
- **Options Considered**: Expo managed, Expo bare, React Native CLI bare, Flutter
- **Decision Rationale**: Expo managed eliminates native build toolchain maintenance. EAS Build provides CI/CD for both platforms. expo-task-manager supports background location. expo-secure-store handles JWT securely. OTA updates via Expo Updates reduce app store release cycles for non-native changes.
- **Consequences**: Native module limitations (none identified for current feature set). EAS Build cost is $29–$99/mo at scale. Ejecting to bare workflow remains possible if native requirements emerge.

---

#### ADR-005: Cloudflare R2 vs AWS S3 for Object Storage

- **Date**: 2025-01-20
- **Status**: Accepted
- **Decision**: Use Cloudflare R2
- **Context**: Object storage for profile photos, exported location data, and media.
- **Options Considered**: Cloudflare R2, AWS S3, Backblaze B2, Self-hosted MinIO
- **Decision Rationale**: R2 has zero egress fees (S3-compatible API). At scale, egress costs on S3 can represent 30–40% of storage bill. R2 is globally distributed via Cloudflare's network. Fully S3-compatible — migration to S3 requires only endpoint URL change.
- **Consequences**: R2 lacks some S3 advanced features (Object Lambda, S3 Select). Acceptable for current use cases. Vendor lock-in mitigated by S3 compatibility.

---

#### ADR-006: JWT vs Server-Side Sessions

- **Date**: 2025-01-10
- **Status**: Accepted
- **Decision**: Use JWT HS256 with refresh token rotation
- **Context**: API authentication mechanism.
- **Options Considered**: JWT (HS256), JWT (RS256), Server-side sessions (Redis-backed), OAuth2 only
- **Decision Rationale**: JWT is stateless — no session store required at Phase 1. HS256 is sufficient for single-server deployment (no key distribution needed). Short-lived access tokens (15 min) limit blast radius of token theft. Refresh token rotation in DB enables revocation.
- **Consequences**: Token revocation before expiry requires DB lookup (refresh token table). If microservices emerge in Phase 3, RS256 enables cross-service verification without shared secret. Session migration possible but requires client changes.

---

#### ADR-007: PostGIS vs Application-Level Geofencing

- **Date**: 2025-01-25
- **Status**: Accepted
- **Decision**: Use PostGIS ST_Contains for server-side geofencing
- **Context**: Geofence boundary evaluation when location updates arrive.
- **Options Considered**: PostGIS (server-side), Application-level geometry math (Node.js), Client-side evaluation, Third-party geofencing API
- **Decision Rationale**: PostGIS spatial indexes evaluate ST_Contains in O(log n) time on indexed data. Application-level implementations require loading all fence polygons into memory. PostGIS supports complex polygon shapes (not just circles). Single source of truth — no synchronization between client and server state.
- **Consequences**: Requires PostGIS extension on PostgreSQL (available on Neon). Spatial index maintenance adds minor write overhead. Complex queries require DBA-level expertise for optimization.

---

#### ADR-008: PM2 vs Docker for Process Management

- **Date**: 2025-01-10
- **Status**: Accepted
- **Decision**: Use PM2 in cluster mode
- **Context**: Application process management and deployment orchestration.
- **Options Considered**: PM2, Docker + Docker Compose, Kubernetes, systemd only
- **Decision Rationale**: PM2 is simpler to operate on a single VPS without container overhead. Zero-downtime reloads via `pm2 reload`. Cluster mode uses all CPU cores. Built-in log management and process monitoring. Docker adds value at multi-server scale (Phase 2+).
- **Consequences**: Dockerfiles maintained for future migration. Kubernetes-ready architecture (stateless app, external DB, external cache) means containerization is straightforward when needed.

---

#### ADR-009: BullMQ vs node-cron for Background Jobs

- **Date**: 2025-02-01
- **Status**: Accepted (Phase 2)
- **Decision**: Use BullMQ with Redis
- **Context**: Background job processing for notifications, geofence evaluations, report generation.
- **Options Considered**: BullMQ, node-cron, Agenda.js (MongoDB-backed), Temporal.io
- **Decision Rationale**: BullMQ provides durable job queues with retry, backoff, and dead-letter queue. node-cron is in-process — lost on server restart. BullMQ jobs survive server restarts. Bull Board provides visual queue monitoring. Redis dependency is already planned for session caching.
- **Consequences**: Redis is now a required infrastructure dependency (Upstash for Phase 2). BullMQ adds ~50ms job enqueue overhead (acceptable for async notification workloads).

---

#### ADR-010: `pg` (node-postgres) vs Prisma ORM

- **Date**: 2025-01-10
- **Status**: Accepted
- **Decision**: Use `pg` (node-postgres) directly with typed query helpers
- **Context**: Database access layer selection.
- **Options Considered**: Prisma ORM, Drizzle ORM, TypeORM, `pg` raw, Knex.js
- **Decision Rationale**: Direct `pg` usage allows full PostGIS function access without ORM abstraction gaps. Prisma's PostGIS support requires raw query escapes for spatial functions, negating ORM benefits. `pg` with Zod-typed result parsers provides type safety without magic. Query performance is transparent and optimizable.
- **Consequences**: No auto-generated migrations — SQL migration files are hand-authored. No ORM query builder — SQL proficiency required. Drizzle ORM is the preferred migration target if ORM is later required (better PostGIS support than Prisma).

---

### 79. Glossary of Terms

| Term | Definition |
|---|---|
| ADR | Architecture Decision Record — a document capturing a key architectural choice and its rationale |
| APNs | Apple Push Notification service — Apple's cloud service for sending push notifications to iOS/macOS devices |
| API | Application Programming Interface — a defined interface for communication between software components |
| bcryptjs | JavaScript implementation of the bcrypt password hashing algorithm |
| BullMQ | A Node.js library for Redis-backed durable message queues and background jobs |
| Caddy | An open-source web server with automatic HTTPS via Let's Encrypt |
| CI/CD | Continuous Integration / Continuous Deployment — automated build, test, and deploy pipelines |
| Cluster mode | PM2 feature that forks one Node.js process per CPU core for parallel request handling |
| Cold start | Latency spike when a serverless function or database connection is initialized after idle period |
| CORS | Cross-Origin Resource Sharing — HTTP header mechanism allowing/denying cross-domain requests |
| CPN | Content Push Notification — generic term for server-initiated push to mobile clients |
| DPDP | Digital Personal Data Protection Act 2023 — India's data protection legislation |
| DPO | Data Protection Officer — role required under GDPR for organizations processing personal data |
| EAS | Expo Application Services — Expo's cloud build, submit, and update platform |
| Egress | Data transferred out of a cloud provider's network (often billed separately) |
| ESLint | JavaScript/TypeScript static analysis tool for enforcing code quality rules |
| Expo | A framework and platform for building React Native applications |
| expo-secure-store | Expo library for encrypted key-value storage on device (Keychain/Keystore) |
| expo-task-manager | Expo library for registering background tasks on iOS and Android |
| FCM | Firebase Cloud Messaging — Google's push notification service for Android |
| Geofence | A virtual geographic boundary defined as a polygon or radius; triggers alerts on entry/exit |
| GDPR | General Data Protection Regulation — EU data protection law (effective 2018) |
| Grafana | Open-source analytics and visualization platform, used with Prometheus for metrics dashboards |
| HSTS | HTTP Strict Transport Security — header forcing browsers to use HTTPS for a domain |
| JWT | JSON Web Token — compact, URL-safe means of representing claims between parties |
| Keystone | Internal name for the API authentication gateway module |
| k6 | Open-source load testing tool by Grafana Labs |
| Leaflet.js | Open-source JavaScript library for mobile-friendly interactive maps |
| Let's Encrypt | Free, automated, open Certificate Authority providing TLS certificates |
| Loki | Grafana's log aggregation system (like Prometheus but for logs) |
| MAU | Monthly Active Users — standard metric for mobile/web application usage |
| MFA | Multi-Factor Authentication — requiring two or more verification factors |
| Neon | Serverless PostgreSQL platform with branching and auto-scaling features |
| Node.js | JavaScript runtime built on Chrome's V8 engine for server-side development |
| OWASP | Open Web Application Security Project — non-profit producing security standards |
| OTA | Over-The-Air update — pushing JavaScript bundle updates to Expo apps without app store release |
| p99 | 99th percentile latency — the response time below which 99% of requests complete |
| PDPA | Personal Data Protection Act — data protection legislation in Thailand and Singapore variants |
| PgBouncer | PostgreSQL connection pooler that reduces database connection overhead |
| PII | Personally Identifiable Information — data that can identify a specific individual |
| PM2 | Process Manager 2 — production process manager for Node.js applications |
| PostGIS | PostgreSQL extension adding support for geographic objects and spatial queries |
| Prettier | Opinionated code formatter for JavaScript/TypeScript |
| Prometheus | Open-source monitoring system and time series database for metrics collection |
| React Native | Framework for building native mobile apps using React and JavaScript |
| Redis | In-memory data structure store used as cache, message broker, and session store |
| Refresh token | Long-lived token used to obtain new access tokens without re-authentication |
| RTO | Recovery Time Objective — maximum acceptable time to restore service after failure |
| RPO | Recovery Point Objective — maximum acceptable data loss measured in time |
| R2 | Cloudflare R2 — S3-compatible object storage with zero egress fees |
| RBAC | Role-Based Access Control — restricting system access based on user roles |
| SemVer | Semantic Versioning — version format MAJOR.MINOR.PATCH with defined rules |
| SOS | Save Our Souls — emergency alert feature triggering immediate family notification |
| SSE | Server-Sent Events — W3C standard for server-to-client push over HTTP |
| SSL/TLS | Secure Sockets Layer / Transport Layer Security — cryptographic protocols for secure communication |
| ST_Contains | PostGIS function returning true if geometry A contains geometry B |
| Traccar | Open-source GPS tracking platform used as the device communication layer |
| TanStack Query | Formerly React Query — library for server-state management in React applications |
| TOTP | Time-Based One-Time Password — MFA standard (RFC 6238) used by authenticator apps |
| TypeScript | Typed superset of JavaScript that compiles to plain JavaScript |
| Upstash | Serverless Redis and Kafka platform with per-request pricing |
| WAF | Web Application Firewall — filters and monitors HTTP traffic to protect web applications |
| Zod | TypeScript-first schema validation library for runtime type checking |
| Zustand | Lightweight state management library for React/React Native |

---

### 80. Appendix

#### Appendix A: Environment Variables Reference

| Variable | Service | Description | Example |
|---|---|---|---|
| `DATABASE_URL` | API | PostgreSQL connection string (Neon) | `postgresql://user:pass@host/db?sslmode=require` |
| `REDIS_URL` | API / Worker | Upstash Redis connection URL | `rediss://default:token@host:6380` |
| `JWT_ACCESS_SECRET` | API | 256-bit secret for access token signing | `openssl rand -hex 32` output |
| `JWT_REFRESH_SECRET` | API | 256-bit secret for refresh token signing | `openssl rand -hex 32` output |
| `JWT_ACCESS_EXPIRY` | API | Access token lifetime | `15m` |
| `JWT_REFRESH_EXPIRY` | API | Refresh token lifetime | `30d` |
| `R2_ACCOUNT_ID` | API | Cloudflare account ID | `abc123def456` |
| `R2_ACCESS_KEY_ID` | API | R2 S3-compatible access key | `R2 Dashboard key` |
| `R2_SECRET_ACCESS_KEY` | API | R2 S3-compatible secret | `R2 Dashboard secret` |
| `R2_BUCKET_NAME` | API | Target R2 bucket name | `gravity-media-prod` |
| `R2_PUBLIC_URL` | API | Public CDN URL for R2 objects | `https://media.trackalways.com` |
| `EXPO_ACCESS_TOKEN` | API | Expo push notification service token | EAS project token |
| `TRACCAR_API_URL` | API | Internal Traccar server URL | `http://localhost:8082` |
| `TRACCAR_ADMIN_TOKEN` | API | Traccar admin API token | Generated in Traccar UI |
| `PORT` | API | HTTP server port | `3000` |
| `NODE_ENV` | API | Environment name | `production` |
| `LOG_LEVEL` | API | Pino log level | `info` |
| `CORS_ORIGIN` | API | Allowed CORS origins (comma-separated) | `https://app.trackalways.com` |
| `RATE_LIMIT_WINDOW_MS` | API | Rate limit window in milliseconds | `900000` (15 min) |
| `RATE_LIMIT_MAX` | API | Max requests per window per IP | `100` |
| `BCRYPT_ROUNDS` | API | bcrypt cost factor | `12` |
| `EXPO_PROJECT_ID` | Mobile | EAS project identifier | UUID from app.json |
| `API_BASE_URL` | Mobile | Backend API base URL | `https://api.trackalways.com` |

---

#### Appendix B: SQL Migration Script Reference

| Migration File | Description | Safe to Rollback |
|---|---|---|
| `001_initial_schema.sql` | Users, groups, group_members tables | No (data loss) |
| `002_location_events.sql` | location_events table + PostGIS extension | Yes (empty table) |
| `003_geofences.sql` | geofences + geofence_events tables | Yes (if no events) |
| `004_sessions.sql` | user_sessions table for refresh tokens | No (auth disruption) |
| `005_sos_alerts.sql` | sos_alerts table | Yes |
| `006_spatial_indexes.sql` | PostGIS GiST indexes on location_events | Yes (drops indexes) |
| `007_audit_log.sql` | audit_log table for compliance | Yes |
| `008_notification_prefs.sql` | notification_preferences table | Yes |
| `009_media_uploads.sql` | media_assets table for R2 references | Yes |
| `010_rate_limit_log.sql` | rate_limit_events for anomaly detection | Yes |

Migration command:
```bash
psql $DATABASE_URL -f migrations/001_initial_schema.sql
# Or via migration runner:
npm run migrate:up
npm run migrate:down  # rolls back last migration
```

---

#### Appendix C: API Postman Collection Structure

```
Gravity API v1
├── Auth
│   ├── POST /api/v1/auth/register
│   ├── POST /api/v1/auth/login
│   ├── POST /api/v1/auth/refresh
│   ├── POST /api/v1/auth/logout
│   └── POST /api/v1/auth/forgot-password
├── Users
│   ├── GET /api/v1/users/me
│   ├── PATCH /api/v1/users/me
│   ├── DELETE /api/v1/users/me
│   └── POST /api/v1/users/me/avatar
├── Groups
│   ├── GET /api/v1/groups
│   ├── POST /api/v1/groups
│   ├── GET /api/v1/groups/:id
│   ├── PATCH /api/v1/groups/:id
│   ├── DELETE /api/v1/groups/:id
│   ├── POST /api/v1/groups/:id/members
│   └── DELETE /api/v1/groups/:id/members/:userId
├── Location
│   ├── POST /api/v1/locations
│   ├── GET /api/v1/locations/group/:groupId
│   ├── GET /api/v1/locations/history
│   └── GET /api/v1/locations/stream (SSE)
├── Geofences
│   ├── GET /api/v1/geofences
│   ├── POST /api/v1/geofences
│   ├── GET /api/v1/geofences/:id
│   ├── PATCH /api/v1/geofences/:id
│   └── DELETE /api/v1/geofences/:id
└── SOS
    ├── POST /api/v1/sos
    └── PATCH /api/v1/sos/:id/resolve
```

Postman environment variables:
- `{{base_url}}` — `https://api.trackalways.com`
- `{{access_token}}` — set by login test script
- `{{refresh_token}}` — set by login test script
- `{{group_id}}` — set after group creation

---

#### Appendix D: Monitoring Metrics Reference

| Metric | Type | Description | Alert Threshold |
|---|---|---|---|
| `gravity_http_requests_total` | Counter | Total HTTP requests by method, route, status | — |
| `gravity_http_request_duration_seconds` | Histogram | Request latency by route | p99 > 2s |
| `gravity_sse_connections_active` | Gauge | Currently open SSE connections | > 500 (single server) |
| `gravity_location_updates_total` | Counter | Location data points stored per minute | < 10/min (low traffic alert) |
| `gravity_geofence_evaluations_total` | Counter | Geofence ST_Contains evaluations | — |
| `gravity_geofence_alerts_triggered` | Counter | Geofence entry/exit alerts fired | > 100/min (storm alert) |
| `gravity_auth_failures_total` | Counter | Failed authentication attempts by reason | > 50/min (brute-force alert) |
| `gravity_push_notifications_sent` | Counter | Push notifications dispatched | — |
| `gravity_push_notifications_failed` | Counter | Push notification delivery failures | > 5% failure rate |
| `gravity_sos_alerts_active` | Gauge | Currently active (unresolved) SOS alerts | > 0 (immediate page) |
| `process_resident_memory_bytes` | Gauge | Node.js process heap usage | > 1 GB per worker |
| `nodejs_eventloop_lag_seconds` | Gauge | Event loop lag — indicates blocking operations | > 100ms |
| `pg_pool_connections_active` | Gauge | Active PostgreSQL connections in pool | > 15 (approaching max) |
| `pg_query_duration_seconds` | Histogram | PostgreSQL query duration | p99 > 500ms |

---

#### Appendix E: Regulatory Compliance Matrix

| Requirement | GDPR (EU) | DPDP Act (India) | PDPA (Thailand) | CCPA (California) | Gravity Status |
|---|---|---|---|---|---|
| Lawful basis for processing | Required (Art. 6) | Required (consent-first) | Required | Required | ✅ Consent on signup |
| Privacy notice | Required (Art. 13/14) | Required | Required | Required | ✅ In-app + web |
| Data subject access request | Required (Art. 15) | Required | Required | Required | ✅ Endpoint implemented |
| Right to erasure | Required (Art. 17) | Required | Required | CCPA right to delete | ✅ Deletion pipeline |
| Data portability | Required (Art. 20) | Planned | Not required | Not required | 🔄 In progress |
| Consent withdrawal | Required | Required | Required | Opt-out | ✅ Account settings |
| Purpose limitation | Required | Required | Required | Partial | ✅ Location only for safety |
| Data minimization | Required | Required | Required | Partial | ✅ No unnecessary fields |
| Storage limitation | Required | Required | Required | Not specified | ✅ 90-day retention |
| Security measures | Required (Art. 32) | Required | Required | Reasonable | ✅ TLS, bcrypt, JWT |
| Breach notification | 72 hours (Art. 33) | As prescribed | 72 hours | Reasonable | 📋 Playbook documented |
| DPO appointment | Required (large processors) | Not yet specified | Required (large) | Not required | 📋 Designated contact |
| Cross-border transfers | SCCs / adequacy | Restricted | Restricted | Not restricted | ⚠️ Neon EU region required |
| Children's data | Extra consent (COPPA-equivalent) | Extra consent | Extra consent | COPPA | ⚠️ Age gate not yet built |
| Third-party processors | DPA required | Not yet mandated | DPA required | Not required | 🔄 Vendor DPAs in progress |

**Legend:** ✅ Compliant | 🔄 In Progress | ⚠️ Gap Identified | 📋 Documented / Planned

---

*End of Part V — Sections 65–80. Gravity Enterprise Documentation — Trackalways Engineering.*

---

# END OF DOCUMENT

---

**TRACKALWAYS GRAVITY — ENTERPRISE TECHNICAL DOCUMENTATION**
Version 3.0.0 | Platform: Gravity 1.0 | Classification: Internal / Confidential
Document compiled: 2026-06-18 | Sections: 80 | Parts: I–V
Maintainer: Trackalways Engineering Team | Contact: engineering@trackalways.com

*This document represents the complete authoritative technical reference for the Trackalways Gravity platform. All sections are to be kept current with each major release. Next scheduled review: 2026-09-18.*
