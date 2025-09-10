# Shop & Delivery Dashboard — Netlify Ready

## Deploy to Netlify (builds for you)

1. Create a new GitHub repo and upload these files.
2. In Netlify: **Add new site → Import from Git** → pick the repo.
3. Build settings:
   - **Build command:** `npm run build`
   - **Publish directory:** `dist`
   - **Node version:** set to 20 (already in `netlify.toml`).
4. Deploy. Every push auto-redeploys.

## Local dev

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
npm install
npm run dev
```
