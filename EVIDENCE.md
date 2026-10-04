# Verification record — 2026-09-27

This record concerns the Recall Radar app as of 2026-09-27, including the fixes made that day. The live exercise used its own watchlist file and port; no OpenAI model call was made.

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

- A read-only `/v1/models` check of the OpenAI key available that day returned HTTP 401 `invalid_api_key`. No model request was made. The adapter has fixture tests only.
- A headless browser exposed Web Speech objects but had no verified microphone or speaker. Code review and UI presence do **not** establish speech behavior. A real-device mic, recognition, spoken output and mute check remain pending.
- The Docker smoke test preceded the final FDA wording edit; the final source was compiled, tested against fixtures, and exercised through live MCP calls on the host. The Dockerfile itself did not change.
- The browser's scripted mode maps known phrases to MCP calls. It was never presented as an LLM. Live source results and the default 90-day window can change before judging.
- No Alexa+ device integration, automatic background alerting or video is claimed.

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
| Demo video | `demo/walkthrough.toml`, rendered with our in-house walkthrough renderer (not in this repository): 2:09, 1920×1080, H.264 + AAC, with captions. Four distinct questions, each asked once of the live `gpt-6-luna` model against live CPSC, FDA and EMA data at render time. Eleven frames were extracted and read; every spoken fact matched the screen. The video file is kept outside the repository. |

## Limits that remain

- **Microphone and speaker were not tested.** The video's questions are entered from the page address (`?q=`), with `mute=1`. Headless Chromium has no microphone or speaker, so push-to-talk, speech recognition and the spoken reply are verified by code reading only. The video says this in its narration.
- **The video's narrator is a local text-to-speech voice (Kokoro)**, not a person and not the app's own speech output. The narration says it is synthetic.
- The capture uses `?tall=1` (added for this) so a card's remedy and link fit in the frame; the default layout is unchanged.
- Other OpenAI models were not exercised. A model that rejects `reasoning_effort` needs `OPENAI_REASONING_EFFORT=omit`; that path has a unit test, not a live run.
- Ollama is still untested. Docker was not rebuilt after these changes; the Dockerfile did not change.
- Live recall results change. The household check's default window was 90 days on 2026-10-02, which would have dropped the 2026-08-06 crib-mattress match on 2026-11-04, before judging (2026-11-09 to 2026-11-20). It is now **180 days** (in range until 2027-02-02), with a test pinning both the default and the judging-period bound. The video was rendered under the 90-day default: its on-screen reply reads "since July 4, 2026". No spoken or captioned line names the window, so it was not re-rendered.
- No Alexa+ device integration is claimed.

## Addendum — 2026-10-02, later the same day (window widened, CPSC outage re-read)

- `check_my_household` now defaults to 180 days (`HOUSEHOLD_DEFAULT_DAYS`). `npm test`: 50 passed, 3 opt-in live tests skipped. A scripted-mode live call with no arguments reported `since: 2026-04-05`, so the new default is in effect.
- **The crib-mattress match was NOT re-verified live under the new default.** That call answered "none … matched … Some sources were unavailable", because CPSC answered HTTP 503 for the new window's URL.
- **Correction to the table above.** The CPSC outage is not limited to the `ProductName` filter. On 2026-10-02 the API answered 503 or 200 consistently per URL: `RecallDateStart=2026-07-04` and `2026-09-01` answered 200, `2026-07-05` and `2026-04-05` answered 503 on every one of 6–8 tries, with or without `ProductName`. That pattern fits an origin that is down with a few cached responses still served; the cause was not established. The fallback found the recall earlier only because its date-only URL was one that answered.
- Consequence: while that outage lasts, product recalls can be missing from any answer; the reply says a source was unavailable. The fallback stays (it costs one extra request and helps when only the filtered query fails). Re-run the household check live once CPSC answers again.
- **Re-read 2026-10-02, a third time:** CPSC still answered HTTP 503 for the 180-day window's URL, with and without `ProductName`, on three tries each. The crib-mattress match under the 180-day default remains unverified live.

## Addendum — 2026-10-02T11:01Z (CPSC partly back; household match re-run)

- **Matched, with an explicit window.** Scripted mode, watchlist "crib mattress", `check_my_household {"since":"2026-04-01"}` at 11:01Z: 1 alert, CPSC recall 26669 dated 2026-08-06 (Voomf play yard and crib mattresses), with its cpsc.gov notice URL and no source warnings. The filtered CPSC request answered 503; the date-only fallback answered 200 and was filtered locally.
- **Not matched under the 180-day default at that moment.** The default window started 2026-04-05, and `…/Recall?format=json&RecallDateStart=2026-04-05` answered HTTP 503 (also with `&ProductName=crib%20mattress`), at 11:00Z. The tool answered "none … matched … Some sources were unavailable". So the default path is still unverified live; the code path is the same as the explicit-window call, only the URL differs.
- **CPSC is intermittent, per URL.** At 11:00Z: `RecallDateStart=2026-04-01`, `2026-04-03`, `2026-07-04` and `2026-09-01` answered 200; `2026-04-05` and `2026-04-06` answered 503. `2026-04-04` answered HTTP 200 with a single placeholder row titled "Error retrieving Recalls: The underlying provider failed on Open." The server now treats that row as a source failure instead of showing it as a recall (test added). `npm test`: 51 passed, 3 opt-in live tests skipped.

## Addendum — 2026-10-02T12:53Z (v0.2.0: EU Safety Gate tool)

- **New tool `search_eu_product_recalls`**, over the EU Safety Gate weekly reports. `check_my_household` is unchanged: it does not read Safety Gate (a test pins that), so the judge path above behaves as before.
- `npm test`: 67 passed, 4 opt-in live tests skipped. `LIVE=1 npx vitest run test/live.test.ts`: the new Safety Gate test passed (4 weekly reports, 4.3 s), openFDA food and drug + EMA passed; CPSC + FDA device failed on a CPSC source warning, the outage recorded above. That code did not change.
- **Live MCP call**, scripted mode on a fresh watchlist and port, at 12:53Z: `npm run call` listed eight tools. `search_eu_product_recalls {"query":"usb charger","limit":3}` answered in 4.7 s cold with three Safety Gate alerts from Report-2026-39 (published 2026-10-02): SR/02654/26 "QUICK CHARGE 3.0", SR/02652/26 "TREQA 25W PD Adapter" and SR/02650/26 "QUICK CHARGER", each with an electric-shock hazard, the measure taken and its `ec.europa.eu/safety-gate-alerts/screen/webReport/alertDetail/…` link, no warnings, and the Commission's attribution sentence in both `attribution` and the text. A barcode query, `6972047909391`, then answered from the cache in 0.5 s with exactly SR/02652/26.
- **Judge walkthrough, scripted mode, same run:** "Watch my crib mattress" → `watchlist_add`; "Has anything in my house been recalled?" → `check_my_household`, which answered "none … matched … Some sources were unavailable" because CPSC still answered 503 for the 180-day window. `main` at v0.1.0, run side by side on another port, gave the identical reply.
- **The MCPB bundle** (`npm run pack:mcpb`, SHA-256 `88d8c1be…aa1c`) was unpacked and run over stdio with the SDK client: server version 0.2.0, eight tools, and a live `search_eu_product_recalls` call returned two alerts with no warnings.
- **Terms.** The Safety Gate disclaimer PDF was re-fetched: still three revisions, the newest dated 2026-06-11, the revision whose attribution reads "2005 – 2026". When the Commission rolls the year, `SAFETY_GATE_ATTRIBUTION` must follow.
- Not checked: the browser UI and the OpenAI path with the eighth tool (the model sees it through `tools/list`; no model call was made), Docker, and Safety Gate's rate limit (each search reads at most 12 reports, four at a time).


## Addendum — 2026-10-02T13:01Z (v0.2.0 in the MCP Registry)

- Published by `.github/workflows/publish-mcp.yml` (run 37010301584, `workflow_dispatch` on `main`): the release bundle's SHA-256 matched `server.json` (`88d8c1be…aa1c`), `validate` passed, `login github-oidc` and `publish` succeeded.
- Read back from the public API, `GET https://registry.modelcontextprotocol.io/v0.1/servers/io.github.MGrin%2Fhousehold-recall-watch/versions/latest`: version `0.2.0`, status `active`, `isLatest: true`, `publishedAt` 2026-10-02T13:01:48Z, package `…/releases/download/v0.2.0/household-recall-watch.mcpb` with the same SHA-256.

## Addendum — 2026-10-04T05:07Z (v0.2.1: resilient CPSC read)

- **Change.** A CPSC read that fails for the window's own URL (HTTP 5xx, network error, or CPSC's "Error retrieving" row) now tries the same window without the product filter, then up to three earlier start dates, and filters the rows to the window here: at most 6 requests in 20 seconds. The answer's new optional `notes` field names the URL that served it. Every good CPSC response is saved beside the watchlist (`cpsc-cache.json`, last 8 URLs, with fetch time). When every live attempt fails, rows of the freshest saved copy inside the window are served, labelled as a saved copy in `warnings`, in each `summary` and in `spoken`. No saved copy: CPSC is reported unavailable, as before. The eight tools, their inputs and their existing output fields are unchanged.
- **CPSC at 05:00Z answered everything.** `RecallDateStart` 2026-04-06, 04-01, 03-01, 01-01, 2025-10-01, 2026-07-01, 08-01 and the 180-day URL with `ProductName=crib%20mattress` all answered HTTP 200. So the outage could not be reproduced live; the fallback and stale paths were exercised live by a script that answered 503 itself for chosen CPSC URLs and passed every other request to the real APIs.
- **Live judge path, scripted watchlist "crib mattress", `check_my_household {}` (default window from 2026-04-07), fresh data dir:**
  - plain: 1 alert, CPSC 26669 dated 2026-08-06, no warnings, no notes; one CPSC request, HTTP 200.
  - window URLs forced to 503: the same alert, no warnings; `notes` named `…RecallDateStart=2026-04-01` (real CPSC, HTTP 200) as the URL that served it, filtered to on or after 2026-04-07.
  - every CPSC URL forced to 503, same data dir: the same alert from the saved copy; 5 attempts, then a warning "Showing a STALE saved copy fetched 2026-10-04T05:06…Z", and `spoken` ended "… may be incomplete. CPSC results come from a saved copy, not a live check."
- `npm test`: 75 passed, 4 opt-in live tests skipped (was 67 + 4 at v0.2.0). New: fallback start dates; exact OK; fallback OK with URL named; rows outside the window dropped; attempts bounded; all fail + saved copy (new process, read from disk); a saved copy for another product not used; all fail + no saved copy; and an MCP end-to-end household check through fallback, then a restart serving the stale copy. No remote CI exists on this repository; all of this is local.
- **The MCPB bundle** (`npm run pack:mcpb`, SHA-256 `3e0073bc…3260`) was unpacked and run over stdio with the SDK client: server version 0.2.1, eight tools.
- Not checked: the browser UI (cards carry no stale marker; the spoken reply and `warnings` do), the OpenAI path, Docker, and how long CPSC's outage pattern will last.
