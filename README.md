# Finger Confirm

Phone-first web app that watches the **front camera**, counts **exactly 1 or 2 raised fingers** on-device, then optionally asks **Grok** to double-check a cropped still.

**Live demo (GitHub Pages):** [rayony.github.io/counting-fingers](https://rayony.github.io/counting-fingers/)

Open that URL on a phone. Tap the black viewport to allow the selfie camera.

If the demo 404s, this is a one-time GitHub setting: repo **Settings → Pages → Source: GitHub Actions**, then re-run the **GitHub Pages** workflow.

## What it does

1. Asks for the front camera (the dark viewport is the permission control).
2. Runs **MediaPipe Hand Landmarker** locally (WASM / GPU when the browser allows it — not CUDA).
3. Ignores 0 or 3+ fingers. A **stable 1 or 2** triggers a crop.
4. Sends the crop to **Grok** (`store: false`) for a second look.
5. Log colors: **red** = Grok confirms 1 or 2; **yellow** = false alarm.
6. After a Grok confirm, a **10s freeze** blocks another capture.

While Grok is still answering, local sampling **slows** (does not stop). A 2nd or 3rd photo is sent only if **local confidence rises**.

## Live Pages vs full app

| | GitHub Pages demo | Full app (`npm run dev`) |
|---|---|---|
| Front camera + local 1/2 count | Yes | Yes |
| Extra shots on rising confidence | Yes | Yes |
| 10s freeze after confirm | After local confirm, or Grok if you paste a key | After Grok confirms |
| Grok double-check | Optional — paste your own xAI key in the page (stays in this browser tab) | Server-side `XAI_API_KEY` |

GitHub Pages is static HTTPS, so there is no server to hide an API key. The Pages demo never uploads photos to GitHub.

There is **no 1-minute remote delete API** on xAI. The supported control is `store: false` (do not keep the request in conversation history).

## Run locally

```bash
git clone https://github.com/rayony/counting-fingers.git
cd counting-fingers
cp .env.example .env
# put XAI_API_KEY=... in .env for Grok verify
npm install
npm run dev
```

Then open the printed local URL on your phone (same Wi-Fi) or in a desktop browser.

## Privacy

- Video never leaves the device except a **JPEG crop of the hand** when 1 or 2 fingers are stable.
- Server verify uses `store: false`.
- Do not commit `.env`. The Pages demo keeps a pasted key in `sessionStorage` only.

## Stack

- TanStack Start + Vite + React
- MediaPipe Tasks Vision (hand landmarks)
- xAI Grok vision for double-check

## License

Apache-2.0. See [LICENSE](LICENSE).
