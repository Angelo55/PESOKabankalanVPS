# Cloudflare R2 Setup — step by step (PESO Kabankalan)

A complete, click-by-click walkthrough to activate the R2 storage layer that the app already
supports (`services/storageService.js`). Follow it top to bottom. The app code is **done** — this
guide only creates the bucket + credentials and wires them into Render via environment variables.

> **What this fixes:** job featured images currently write to the server's local disk, which is
> wiped on every Render deploy — so images uploaded in production disappear. After this setup,
> production stores them in Cloudflare R2 (durable object storage) and they persist.

> **You do NOT touch code.** Everything below is Cloudflare dashboard + Render dashboard.
> Nothing here changes local development — your laptop keeps using `uploads/` as before.

---

## What you'll end up with (the six values)

By the end you will have collected these, and pasted them into Render:

| Env var | Where it comes from |
|---|---|
| `STORAGE_DRIVER` | you type `r2` |
| `R2_ACCOUNT_ID` | Cloudflare → R2 overview (right side) |
| `R2_ACCESS_KEY_ID` | shown when you create the R2 API token |
| `R2_SECRET_ACCESS_KEY` | shown when you create the R2 API token (**once**) |
| `R2_BUCKET` | the bucket name you choose |
| `R2_PUBLIC_BASE_URL` | the bucket's public `r2.dev` URL (or a custom domain) |

Keep a scratch note open to paste these as you go. Treat the secret access key like a password.

---

## Step 1 — Open R2 and enable it

1. Go to **https://dash.cloudflare.com** and sign in (you're already logged in with
   `angelopamalacsao@gmail.com` via GitHub).
2. In the **left sidebar**, click **R2 Object Storage** (sometimes just **R2**).
   - If you don't see it, click **"R2"** under the **Storage & Databases** group, or use the
     search box at the top and type "R2".
3. **First time only:** Cloudflare asks you to **enable R2** and **add a payment method**.
   - ⚠️ R2 requires a card on file to activate **even though you'll stay on the free tier**
     (10 GB storage + generous ops, and **zero egress fees** — this project uses a sliver of it).
     Add the card; you will not be charged at this usage.
   - Accept the terms → **Purchase R2 / Enable**. You now see the R2 overview page.

---

## Step 2 — Note your Account ID

1. On the **R2 overview** page, look at the **right-hand side** (or the top). You'll see
   **Account ID** — a 32-character hex string, and an **S3 API** endpoint that looks like
   `https://<account_id>.r2.cloudflarestorage.com`.
2. Copy the **Account ID** → this is **`R2_ACCOUNT_ID`**.
   *(You don't need to copy the endpoint — the app builds it from the account id.)*

---

## Step 3 — Create the bucket

1. On the R2 page click **Create bucket**.
2. **Bucket name:** `peso-kabankalan-assets`
   *(lowercase, letters/numbers/hyphens only; if it's taken, add a suffix like `-01`).*
   → this is **`R2_BUCKET`**.
3. **Location:** leave **Automatic** (the default). **Storage class:** **Standard**.
4. Click **Create bucket**. You're taken into the empty bucket.

---

## Step 4 — Make the bucket publicly readable (via r2.dev)

Job featured images are public marketing content, so we let them be read over a public URL.

1. Inside the bucket, open the **Settings** tab.
2. Find **Public access** → **R2.dev subdomain** (or **"Public Development URL"**).
3. Click **Allow Access** / **Enable**. Cloudflare warns the objects become publicly readable —
   that's intended for these images. Confirm by typing **allow** if prompted.
4. It now shows a **Public bucket URL** like `https://pub-<hash>.r2.dev`.
5. Copy that whole URL (no trailing slash) → this is **`R2_PUBLIC_BASE_URL`**.

> The `r2.dev` URL is rate-limited by Cloudflare and meant for light/dev use — perfect for a
> capstone. Later, for production polish, you can attach a **custom domain** (Step 8) and use that
> as `R2_PUBLIC_BASE_URL` instead; nothing else changes.

---

## Step 5 — Create an R2 API token (access key + secret)

1. Go back to the **R2 overview** (bucket list). On the right, click **Manage R2 API Tokens**
   (or **{ } API** → **Manage API tokens**).
2. Click **Create API token** (a.k.a. **Create Account API token**).
3. **Token name:** `peso-render-backend`.
4. **Permissions:** choose **Object Read & Write**.
5. **Specify bucket(s):** select **Apply to specific buckets only** → pick
   `peso-kabankalan-assets` (least privilege — the token can only touch this bucket).
6. **TTL:** leave the default (or "Forever" if offered).
7. Click **Create API Token**.
8. Cloudflare now shows, **once**:
   - **Access Key ID** → **`R2_ACCESS_KEY_ID`**
   - **Secret Access Key** → **`R2_SECRET_ACCESS_KEY`** (⚠️ shown only now — copy it immediately)
   - (also an S3 endpoint — ignore, the app builds it)
9. Paste both into your scratch note. If you lose the secret, delete this token and make a new one.

You now have **all six values**.

---

## Step 6 — Put the values into Render (this is what activates it)

1. Go to **https://dashboard.render.com** and open your backend service
   (**peso-kabankalan-backend**).
2. Open the **Environment** tab (left menu).
3. Click **Add Environment Variable** and add these six, one per row — **exactly**, with **no
   leading/trailing spaces** (retype `r2`, don't paste it, to avoid a stray space — a trailing
   space silently disables the driver):

   ```
   STORAGE_DRIVER          r2
   R2_ACCOUNT_ID           <the 32-char account id from Step 2>
   R2_ACCESS_KEY_ID        <access key from Step 5>
   R2_SECRET_ACCESS_KEY    <secret key from Step 5>
   R2_BUCKET               peso-kabankalan-assets
   R2_PUBLIC_BASE_URL      https://pub-<hash>.r2.dev
   ```

4. Click **Save Changes**. Render **redeploys automatically** (~1–2 min).

> Do **not** put these in the frontend (Vercel). The browser never sees the keys — only the
> backend uses them, and the frontend only ever receives the resulting public image URL.

---

## Step 7 — Verify it's live

1. In Render, open the service's **Logs**. After the redeploy you should see, near the top:
   ```
   [Storage] driver=r2 (r2Configured=true, base=https://pub-...r2.dev)
   ```
   - If it says `driver=local`, `STORAGE_DRIVER` isn't exactly `r2` (retype it — Step 6).
   - If it says `r2Configured=false`, one of the `R2_*` vars is missing/empty.
2. In the live app, sign in as a **PESO Administrator**, open **Job Publication Management**,
   edit a posting, and **upload a featured image**. It should appear immediately.
3. Confirm the image URL is an R2 URL: right-click the image → the `src` should start with your
   `https://pub-...r2.dev/job-featured/...`.
4. The real proof: trigger a redeploy (or wait for the next one) and confirm the image **still
   loads** — that's the ephemeral-disk problem solved.
5. (Optional) In the R2 bucket → **Objects** tab, you'll see the uploaded file under
   `job-featured/`.

---

## Step 8 (optional, later) — custom domain for cleaner URLs

If you own a domain on Cloudflare (or add one), you can serve images from e.g.
`https://cdn.peso-kabankalan.<yourdomain>` instead of the `r2.dev` URL:

1. Bucket → **Settings** → **Custom Domains** → **Connect Domain** → enter the subdomain.
2. Cloudflare auto-creates the DNS + certificate.
3. Change **`R2_PUBLIC_BASE_URL`** in Render to `https://cdn.peso-kabankalan.<yourdomain>` → save.
   Nothing else changes; new uploads use the new base immediately.

---

## Notes & FAQ

- **CORS?** Not needed. The browser never uploads directly to R2 (it uploads to the Render
  backend, which forwards to R2), and `<img>` tags display public objects without CORS. Leave CORS
  unset.
- **Local development is unchanged.** With `STORAGE_DRIVER` unset (your laptop), the app uses
  `uploads/` exactly as before. You only need R2 vars on Render.
- **Existing/old job images** that were on Render's disk before this change were already lost to
  the ephemeral filesystem — just re-upload them once; from now on they persist.
- **Cost:** within the free tier (10 GB + zero egress) this project effectively costs **$0/mo**.
- **Which files use R2:** only **job featured images** for now. Résumés, referral letters,
  certificates, avatars, and event banners deliberately stay base64-in-DB (they already work in
  production) — see `docs/cloud-storage-proposal.md` for the deferred phased migration of those.
- **Rotating a leaked key:** R2 → Manage API Tokens → delete the token → create a new one →
  update the two `R2_*` key vars in Render.
