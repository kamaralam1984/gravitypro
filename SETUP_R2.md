# Cloudflare R2 Setup Guide

R2 credentials are the only missing piece. Follow these steps:

## Step 1: Create R2 Bucket

1. Go to https://dash.cloudflare.com
2. Left sidebar → **R2 Object Storage**
3. Click **Create bucket**
4. Name: `gravity-assets`
5. Region: Auto (or closest to your users)
6. Click **Create bucket**

## Step 2: Enable Public Access

1. Open the `gravity-assets` bucket
2. Click **Settings** tab
3. Under **Public access** → click **Allow Access**
4. Copy the **Public bucket URL** — looks like:  
   `https://pub-xxxxxxxxxxxxxxxx.r2.dev`

## Step 3: Create API Token

1. Back to R2 overview page
2. Click **Manage R2 API Tokens** (top right)
3. Click **Create API token**
4. Name: `gravity-backend`
5. Permissions: **Object Read & Write** (for `gravity-assets` bucket only)
6. Click **Create API Token**
7. Copy:
   - **Access Key ID**
   - **Secret Access Key**
   - **Account ID** (shown at top of page)

## Step 4: Update .env

Edit `/media/server/linux-part/Gravity/backend/.env`:

```bash
R2_ACCOUNT_ID=<your-account-id>
R2_ACCESS_KEY_ID=<your-access-key>
R2_SECRET_ACCESS_KEY=<your-secret-key>
R2_BUCKET_NAME=gravity-assets
R2_PUBLIC_URL=https://pub-xxxxxxxxxxxxxxxx.r2.dev
```

## Step 5: Restart API

```bash
pm2 restart gravity-api
```

## Step 6: Test Upload

```bash
curl -X POST http://localhost:3021/api/v1/media/presigned-url \
  -H "Authorization: Bearer <your-jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{"filename":"avatar.jpg","content_type":"image/jpeg"}'
```

Should return `{"upload_url":"...","public_url":"..."}`.
