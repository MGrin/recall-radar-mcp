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

---

# Verification record — 2026-10-02 (live model check and demo video)

Supersedes the two 2026-09-27 limits about the OpenAI key and the missing video. Everything else above stands.

| Check | Result |
|---|---|
| OpenAI key | `GET /v1/models` returned HTTP 200 with a new key; `gpt-6-luna` (the adapter default) is listed. The key is never printed, logged or committed. |
| First live call, before the fix | **Failed.** `gpt-6-luna` answered HTTP 400: *"Function tools with reasoning_effort are not supported for gpt-6-luna in /v1/chat/completions … set reasoning_effort to 'none'."* The fixture tests had not caught it. |
| Fix | The OpenAI adapter now sends `reasoning_effort: "none"` (`OPENAI_REASONING_EFFORT`, `omit` leaves the field out; never sent to Ollama). Unit test added. |
| Live agent loop, `gpt-6-luna`, after the fix | `POST /api/ask` × 3, all HTTP 200, 2 model steps each, 3–7 s. "Watch my crib mattress and my ibuprofen" produced two `watchlist_add` calls in one turn (product, medicine). "Has anything in my house been recalled?" called `check_my_household` and answered with the 2026-08-06 CPSC Voomf play-yard and crib-mattress recall. "Is there a recall on peanut butter?" called `search_food_recalls` and returned five FDA food records. |
| CPSC outage found during the check | CPSC's `ProductName` filter answered HTTP 503 ("Under Construction") while the date-only listing answered 200. The model reply said so: *"The CPSC source was unavailable, so this check may be incomplete."* `searchCpsc` now falls back to the date-only listing and filters locally; test added. After the fix the household check found the CPSC recall while the upstream filter was still down. |
| `npm run build`; `npm test` | Passed; 50 passed, 3 opt-in live tests skipped. |
| Demo video | `demo/walkthrough.toml`, rendered with the studio media toolkit: 2:09, 1920×1080, H.264 + AAC, with captions. Four distinct questions, each asked once of the live `gpt-6-luna` model against live CPSC, FDA and EMA data at render time. Eleven frames were extracted and read; every spoken fact matched the screen. The file is a draft held outside the repository and is not published. |

## Limits that remain

- **Microphone and speaker were not tested.** The video's questions are entered from the page address (`?q=`), with `mute=1`. Headless Chromium has no microphone or speaker, so push-to-talk, speech recognition and the spoken reply are verified by code reading only. The video says this in its narration.
- **The video's narrator is a local text-to-speech voice (Kokoro)**, not a person and not the app's own speech output. The narration says it is synthetic.
- The capture uses `?tall=1` (added for this) so a card's remedy and link fit in the frame; the default layout is unchanged.
- Other OpenAI models were not exercised. A model that rejects `reasoning_effort` needs `OPENAI_REASONING_EFFORT=omit`; that path has a unit test, not a live run.
- Ollama is still untested. Docker was not rebuilt after these changes; the Dockerfile did not change.
- Live recall results change. The household check's default window was 90 days on 2026-10-02, which would have dropped the 2026-08-06 crib-mattress match on 2026-11-04, before judging (2026-11-09 to 2026-11-20). It is now **180 days** (in range until 2027-02-02), with a test pinning both the default and the judging-period bound. The video was rendered under the 90-day default: its on-screen reply reads "since July 4, 2026". No spoken or captioned line names the window, so it was not re-rendered.
- No Alexa+ device integration, public repository, reviewer invitation, video upload, Devpost registration or submission has happened.

## Addendum — 2026-10-02, later the same day (window widened, CPSC outage re-read)

- `check_my_household` now defaults to 180 days (`HOUSEHOLD_DEFAULT_DAYS`). `npm test`: 50 passed, 3 opt-in live tests skipped. A scripted-mode live call with no arguments reported `since: 2026-04-05`, so the new default is in effect.
- **The crib-mattress match was NOT re-verified live under the new default.** That call answered "none … matched … Some sources were unavailable", because CPSC answered HTTP 503 for the new window's URL.
- **Correction to the table above.** The CPSC outage is not limited to the `ProductName` filter. On 2026-10-02 the API answered 503 or 200 consistently per URL: `RecallDateStart=2026-07-04` and `2026-09-01` answered 200, `2026-07-05` and `2026-04-05` answered 503 on every one of 6–8 tries, with or without `ProductName`. That pattern fits an origin that is down with a few cached responses still served; the cause was not established. The fallback found the recall earlier only because its date-only URL was one that answered.
- Consequence: while that outage lasts, product recalls can be missing from any answer; the reply says a source was unavailable. The fallback stays (it costs one extra request and helps when only the filtered query fails). Re-run the household check live once CPSC answers again.
