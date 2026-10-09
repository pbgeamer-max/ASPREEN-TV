# Aspreen TV — Private Stream Relay Platform

> **Firebase Cloud Firestore + FFmpeg + M3U/M3U8 Private Stream Relay & Transcoding Management Platform**

**Aspreen TV** is a private streaming management infrastructure built for administrators to import authorized M3U playlists, ingest direct M3U8 live sources, transcode streams with FFmpeg, generate cryptographically protected HLS playback URLs, and stream to authorized Android applications or websites.

---

## 1. Official Branding & Design Principles

* **Application Name:** Aspreen TV
* **Browser Title:** `Aspreen TV | Stream Management`
* **Dashboard Title:** `Aspreen TV — Streaming Dashboard`
* **Login Heading:** `Welcome to Aspreen TV`
* **Logo Wordmark:** Monochrome `Aspreen TV`
* **Favicon:** Black-and-white `ATV` monogram
* **Theme:** **Strict Monochrome Dark**. Pure blacks (`#080808`), dark grays (`#0A0A0A` to `#171717`), borders (`#262626`), and light text (`#F5F5F5`).
* **Buttons:** Primary buttons are **pure white background with black text**; secondary buttons are **dark gray with subtle borders**.
* **Zero Colored Accents:** All status indicators, badges, charts, and metrics are styled using grayscale tones.

Centralized branding is located in [`packages/shared/src/branding.ts`](file:///c:/Users/Admin/Desktop/ASPREEN%20TV/packages/shared/src/branding.ts) so changes propagate across all pages without manual edits.

---

## 2. Technology Stack & Architecture

```
Administrator Browser / Android App
             │
             ▼
     Next.js Frontend (Port 3000)
             │
     ┌───────┴───────────────────────┐
     │ Firebase Web SDK              │
     │ (Admin Authentication)        │
     └───────────────────────────────┘
             │ (Bearer ID Token / Session Cookie)
             ▼
   Fastify Backend API (Port 3001)
     ├── Firebase Admin SDK
     │     └── Cloud Firestore (Primary Database)
     ├── AES-256-GCM Credential Encryption
     ├── SSRF & DNS Protection Engine
     └── Token SHA-256 Hashing Validator
             │
             ▼
  FFmpeg Dedicated Worker (VPS)
     ├── Preset 1: Compatible Stream Copy
     ├── Preset 2: H.264 + AAC — Source Resolution
     ├── Preset 3: H.264 + AAC — 720p (2500 kbps)
     └── Preset 4: H.264 + AAC — 1080p (5000 kbps)
             │
             ▼
 Persistent VPS Storage (`/var/www/aspreen/hls/`)
             │
             ▼
 Nginx Reverse Proxy (HTTPS + auth_request)
             │  (Subrequest verifies token against Fastify /api/hls-auth)
             └── Protects BOTH .m3u8 playlists AND .ts media segments
```

* **Frontend:** Next.js 14, TypeScript, Tailwind CSS, Lucide icons, Hls.js stream preview player.
* **Backend:** Node.js 22+, Fastify, Firebase Admin SDK, Zod, AES-256-GCM authenticated encryption.
* **Database:** **Google Cloud Firestore** (the sole primary application database).
* **Streaming Engine:** FFmpeg & FFprobe 8+ with argument array execution (no shell interpolation).
* **Delivery:** Nginx with `auth_request` verifying tokens for playlists and individual media segments.

---

## 3. Cloud Firestore Database Collections

1. `adminSettings/general`: Application settings, public streaming base URL, defaults, and concurrency limits.
2. `sources`: Source records with AES-256-GCM encrypted remote URLs and credentials.
3. `channels`: Imported stream channels, codec configurations, active output directories, and status.
4. `transcodingJobs`: State machine for FFmpeg processes (`QUEUED`, `STARTING`, `RUNNING`, `STOPPED`, `FAILED`), PIDs, and heartbeats.
5. `streamTokens`: SHA-256 cryptographic hashes of bearer tokens, expiration, revocation, and last used timestamps.
6. `activityLogs`: Audit logs with sensitive URLs and tokens scrubbed and redacted.
7. `systemMetrics`: Sampled VPS telemetry (CPU, memory, disk, bandwidth).

---

## 4. Complete Firebase Administrator Setup Guide

Follow these 10 steps to connect Aspreen TV to your Google Firebase project:

### Step 1: Create a Firebase Project
1. Go to the [Firebase Console](https://console.firebase.google.com/).
2. Click **Add project** and name it (e.g., `aspreen-tv-prod`).
3. Disable Google Analytics (optional) and click **Create project**.

### Step 2: Enable Cloud Firestore
1. In the Firebase console left menu, navigate to **Build > Firestore Database**.
2. Click **Create database**.
3. Select your production region (e.g., `us-central1` or `europe-west1`).
4. Choose **Start in production mode**.

### Step 3: Enable Email/Password Authentication
1. Navigate to **Build > Authentication**.
2. Click **Get Started** and select the **Sign-in method** tab.
3. Enable **Email/Password** provider (do NOT enable public sign-up or email link).

### Step 4: Create Initial Administrator Account
1. Under **Authentication > Users**, click **Add user**.
2. Enter your administrator email (e.g., `admin@yourdomain.com`) and a strong password.
3. Copy the generated **UID** (e.g., `aBcDeFg1234567890`).

### Step 5: Restrict Access to the Administrator
1. In your `.env` configuration file on the VPS or server:
   ```env
   ADMIN_AUTHORIZED_UIDS=aBcDeFg1234567890
   ```
2. The Fastify backend rejects any authenticated account whose UID is not in `ADMIN_AUTHORIZED_UIDS`.

### Step 6: Configure Frontend Firebase Settings
1. In Firebase Console, go to **Project settings > General**.
2. Under **Your apps**, click the Web icon (`</>`) to register a Web app (`Aspreen TV Web`).
3. Copy the configuration values into your frontend environment variables:
   ```env
   NEXT_PUBLIC_FIREBASE_PROJECT_ID=aspreen-tv-prod
   NEXT_PUBLIC_FIREBASE_API_KEY=AIzaSy...
   NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=aspreen-tv-prod.firebaseapp.com
   NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=aspreen-tv-prod.appspot.com
   ```

### Step 7: Configure Secure Backend Access (Admin SDK)
1. In Firebase Console, go to **Project settings > Service accounts**.
2. Click **Generate new private key** and confirm.
3. Open the downloaded JSON file and extract the values to your server `.env` (NEVER commit this file to Git):
   ```env
   FIREBASE_PROJECT_ID=aspreen-tv-prod
   FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@aspreen-tv-prod.iam.gserviceaccount.com
   FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvgIBA...-----END PRIVATE KEY-----\n"
   ```

### Step 8: Deploy Firestore Security Rules
Deploy [`infrastructure/firebase/firestore.rules`](file:///c:/Users/Admin/Desktop/ASPREEN%20TV/infrastructure/firebase/firestore.rules) using the Firebase CLI:
```bash
firebase deploy --only firestore:rules
```
*Note: Rules default to denying all direct client reads/writes (`allow read, write: if false;`). Privileged access is performed exclusively by the backend API via the Admin SDK.*

### Step 9: Deploy Firestore Indexes
Deploy [`infrastructure/firebase/firestore.indexes.json`](file:///c:/Users/Admin/Desktop/ASPREEN%20TV/infrastructure/firebase/firestore.indexes.json):
```bash
firebase deploy --only firestore:indexes
```

### Step 10: Test the Application Against Firebase
Run the automated test suite to verify Firestore repositories and endpoints:
```bash
npm test
```

---

## 5. Security & SSRF Protection

Aspreen TV prevents Server-Side Request Forgery (SSRF) when fetching playlists or spawning FFmpeg:
* **Protocol Allowlist:** Only `http:` and `https:` schemes are accepted. Schemes such as `file:`, `gopher:`, `dict:`, and `ftp:` are blocked.
* **Private IP Blocking:** Rejects loopback (`127.0.0.0/8`, `::1`), RFC 1918 private ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), and link-local (`169.254.0.0/16`, `fe80::/10`).
* **Cloud Metadata Protection:** Explicitly denies requests to AWS/GCP/Azure metadata services (`169.254.169.254`, `metadata.google.internal`).
* **DNS Resolution Verification:** Resolves DNS records before connecting and verifies every returned IPv4 and IPv6 address.
* **Credential Encryption:** All source URLs and bearer credentials are encrypted using **AES-256-GCM** with unique 12-byte initialization vectors and authentication tags before saving to Firestore.
* **FFmpeg Argument Arrays:** FFmpeg is executed strictly via process argument arrays (`spawn`), preventing command injection.

---

## 6. Protected Stream Tokens & HLS Delivery

Stream playback links use the format:
```
https://stream.yourdomain.com/hls/{publicOutputId}/{token}/index.m3u8
```

### Protection Mechanism:
1. When generating a link, a 32-byte cryptographically random hex token is produced.
2. Only its **HMAC SHA-256 hash** is saved in Firestore (`streamTokens` collection).
3. The raw bearer URL is revealed **once** to the administrator upon generation.
4. When a player requests `index.m3u8` or any `segment_XXXX.ts`:
   * Nginx sends an internal subrequest to Fastify `/api/hls-auth`.
   * Fastify hashes the token, checks Firestore, confirms it is not expired or revoked, and verifies the output ID.
   * If valid, Fastify returns `200 OK`, and Nginx streams the segment.
   * If revoked or expired, Fastify returns `403 Forbidden`, immediately blocking both playlist and media segment access.

---

## 7. Local Development & Testing

### Prerequisites
* Node.js v20+ (tested on Node.js v24)
* FFmpeg & FFprobe installed in PATH

### Quick Start
1. Clone the repository and install dependencies:
   ```bash
   npm install
   ```
2. Build shared and API packages:
   ```bash
   npm run build
   ```
3. Run the automated test suite (22 unit, integration, and E2E tests):
   ```bash
   npm test
   ```
4. Start local development servers:
   ```bash
   npm run dev
   ```
   * Next.js Web: [http://localhost:3000](http://localhost:3000)
   * Fastify API: [http://localhost:3001](http://localhost:3001)

*Note: For testing without live Firebase credentials, click **"Launch Demo Console (Admin Mode)"** on the login screen to access the full administrator dashboard in local standalone mode.*

---

## 8. VPS Production Deployment with Docker Compose

### 1. Prepare Environment
Copy `.env.example` to `.env` on your VPS:
```bash
cp .env.example .env
nano .env
```
Fill in your `FIREBASE_*` credentials, `ENCRYPTION_KEY` (generate with `openssl rand -hex 32`), and `PUBLIC_STREAM_BASE_URL`.

### 2. Launch Services
```bash
docker compose up -d --build
```

### 3. Verify Container Status
```bash
docker compose ps
docker compose logs -f api
```

### 4. Configure HTTPS (Certbot / Let's Encrypt)
On your VPS host or within Nginx:
```bash
certbot --nginx -d stream.yourdomain.com
```

---

## 9. API Endpoints Reference

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/auth/session` | Exchange Firebase ID token for secure session cookie |
| `POST` | `/api/auth/logout` | Clear administrator session |
| `GET` | `/api/auth/session` | Get current session status |
| `GET` | `/api/dashboard/summary` | Aggregated dashboard metrics & live system telemetry |
| `GET` | `/api/sources` | List all streaming sources |
| `POST` | `/api/sources` | Add M3U8, remote M3U, or local M3U source |
| `POST` | `/api/sources/:id/validate` | Test SSRF & target connectivity |
| `POST` | `/api/sources/:id/refresh` | Re-fetch and synchronize remote M3U channels |
| `DELETE`| `/api/sources/:id` | Delete source and associated channels |
| `GET` | `/api/channels` | List channels (search, source, group filters) |
| `POST` | `/api/channels/:id/inspect` | FFprobe inspection of stream codecs & bitrate |
| `POST` | `/api/channels/:id/start` | Launch FFmpeg transcoding process |
| `POST` | `/api/channels/:id/stop` | Gracefully terminate transcoding process |
| `GET` | `/api/jobs` | Supervisor list of active/historical transcoding jobs |
| `POST` | `/api/channels/:id/tokens` | Issue protected playback token & reveal URL |
| `DELETE`| `/api/stream-tokens/:id` | Revoke stream token (immediate termination) |
| `POST` | `/api/stream-tokens/:id/rotate` | Replace token with a fresh playback token |
| `GET` | `/api/hls-auth` | Nginx subrequest authorization hook for HLS files |
| `GET` | `/api/settings` | Read application settings |
| `PATCH`| `/api/settings` | Update multiplexer and concurrency settings |
| `GET` | `/api/health` | Service health check (API, Firebase, FFmpeg, Storage) |

---

## 10. Operational Reliability & Disaster Recovery

* **Firestore Transient Disruption:** The worker reports state changes with exponential backoff and preserves running FFmpeg child processes rather than creating duplicate jobs.
* **VPS Restart Recovery:** Upon startup, stale jobs without recent heartbeats are marked as interrupted. Reconnect flags automatically recover remote input drops.
* **Storage Maintenance:** HLS multiplexing uses `-hls_flags delete_segments` to maintain a fixed sliding window on disk, preventing storage exhaustion.
