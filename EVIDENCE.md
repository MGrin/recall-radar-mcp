# Verification record — 2026-09-27

This record concerns the existing Recall Radar app on `origin/main` plus the focused fixes in this PR. All app data and ports used for live exercise were isolated to this thread; no OpenAI model call was made.

| Check | Result |
|---|---|
| Clean `npm ci --ignore-scripts`; `npm run build` | Passed on Node 26.7.0 / npm 11.19.0. |
| `npm test` | 48 passed; 3 opt-in live tests skipped. |
| `NODE_USE_ENV_PROXY=1 npm run test:live` | 3 passed: CPSC + FDA device, FDA food, FDA drug + EMA; real public endpoints, no API key. |
| HTTP MCP server on `127.0.0.1:58520` | `/healthz` returned protocol `2025-11-25`; SDK client listed seven tools. A raw `initialize` POST negotiated `2025-11-25` as an SSE response. |
| Live MCP medicine call (`insulin`, US + EU) | Returned a dated FDA drug record and EMA shortages with source URLs and no warnings. After the fix, FDA drug remedy tells the user not to stop or change medicine without a pharmacist or doctor. The FDA recall-number link returned HTTP 200. |
| FDA medical-device wording | A fixture test reproduced generic “if in doubt, stop using it” advice on a device record. After the repair, a live MCP `search_product_recalls` call for `thermometer` since `2023-01-01` returned two FDA device records; the first (2024-07-17) directed the user to a health care provider before changing use, with no source warnings. This follows [FDA's explanation](https://www.fda.gov/medical-devices/medical-device-recalls-and-early-alerts/what-medical-device-recall) that device recalls may require a correction rather than stopping use. |
| Browser UI at 800×519, scripted mode | Badge explicitly said “Scripted mode, no LLM”. Live `watchlist_add`, `check_my_household`, product and food searches, `watchlist_list` and `watchlist_remove` showed MCP traces. The household card matched the 2026-08-06 CPSC crib-mattress recall. The `?q=...&q=...` walkthrough completed with a source card and transcript. |
| Responsive watchlist control | Before the CSS fix, the footer intercepted the remove button and a real browser click timed out. After the fix, the same click called `watchlist_remove` and the panel emptied. |
| Distribution | `npm pack` after build contained `dist/`, `web/`, scripts, README, license, friction log and judge/submission/evidence docs. Installing a tarball into a clean consumer directory served the UI, answered `/api/ask`, and negotiated MCP `2025-11-25`. |
| Docker | Image built from the repo with ownership labels. A capped, isolated container served `/healthz`, UI and scripted config; its Docker healthcheck became `healthy`. The owned container and image were removed after the check. |
| Production dependency audit | `npm audit --omit=dev` reported 0 vulnerabilities. Full audit reported 2 moderate findings in `vitest` / `@vitest/mocker` development dependencies; no dependency change made in this preparation task. |
| Remote CI | The GitHub repository had 0 Actions workflows when checked. All verification above is local; no remote CI result is claimed. |

## Limits and pending checks

- The parent's fresh read-only `/v1/models` check of the available OpenAI key returned HTTP 401 `invalid_api_key`, even after `opc --fresh`. This worker did not repeat the probe or spend on a model request. The adapter has fixture tests only.
- A headless browser exposed Web Speech objects but had no verified microphone or speaker. Code review and UI presence do **not** establish speech behavior. A real-device mic, recognition, spoken output and mute check remain pending.
- The Docker smoke test preceded the final FDA wording edit; the final source was compiled, tested against fixtures, and exercised through live MCP calls on the host. The Dockerfile itself did not change.
- The browser's scripted mode maps known phrases to MCP calls. It was never presented as an LLM. Live source results and the default 90-day window can change before judging.
- No Alexa+ device integration, automatic background alerting, video, public repository, reviewer invitation, Devpost registration or submission is claimed.
