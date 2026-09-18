# GitHub Pages demo

This folder is the static site published to:

**https://rayony.github.io/counting-fingers/**

It is a self-contained front-camera demo (MediaPipe from a CDN). The React / TanStack app in the repo root is what you run with `npm run dev` when you want server-side Grok verify.

## Deploy

Push to `main`. [`.github/workflows/pages.yml`](../.github/workflows/pages.yml) uploads this `docs/` folder to GitHub Pages.

**First time:** GitHub blocks creating a Pages site until you pick a source. Open

[Settings → Pages](https://github.com/rayony/counting-fingers/settings/pages)

and set **Source** to **GitHub Actions**. Re-run the workflow (Actions → GitHub Pages → Run workflow), or push another commit.

## Camera

Browsers only allow `getUserMedia` on **HTTPS** (or localhost). GitHub Pages is HTTPS, so a phone can grant the selfie camera.

## Grok on Pages

Paste an xAI API key in the optional field if you want the same double-check as the full app. The key stays in this tab (`sessionStorage`). Leave it blank to use **local detection only**.
