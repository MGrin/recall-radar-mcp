# Devpost submission draft — do not submit yet

- **Primary track:** Alexa+
- **Project:** Recall Radar
- **Tagline:** Ask about household recalls, keep a watchlist, and follow every answer to its public source.
- **Entrant:** Nikita Grishin Limited (Devpost registration pending mgrin)
- **Repository:** <https://github.com/MGrin/recall-radar-mcp> (currently private)
- **Mini challenges:** None claimed here. The separate recall-feeds Open Source mini-challenge work is pending; do not select it until a qualifying public contribution exists. No AWS Builder claim.

## Project description (update pending checks before pasting)

“Has anything in my house been recalled?” is a hard question to answer from memory. Recall Radar gives a household assistant a watchlist and seven MCP tools to check public US product, food, device and drug recall records, plus European medicine shortages. A person can add a crib mattress, ask about their household, and see the matching notice with its date, hazard, remedy and official link.

The entry runs a self-hosted MCP server over Streamable HTTP using MCP protocol version `2025-11-25`. Its TypeScript server imports and calls the MCP SDK at runtime. A companion web app simulates a smart display: it shows the answer, source cards, transcript and each MCP tool call. The app also has browser speech controls and typed input. The watchlist is stored locally and checked on request; it does not send automatic alerts.

We built this during the hackathon window. CPSC, openFDA and EMA need no API key. A deterministic, visibly labelled scripted mode lets a judge run the real MCP tools and live public data without a model account. An OpenAI adapter and agent tool loop are implemented, with fixture tests; a successful live OpenAI call and microphone/speaker exercise are still pending. We will record the public demo only after those checks. This is a simulated Alexa+ experience; no Alexa+ device connection is claimed.

The most useful design choice is provenance: a spoken headline stays short, while each card carries the source URL and date. If an upstream fails, the response reports a warning. Medicine text tells users to consult a pharmacist or doctor before changing treatment. This is an on-demand information aid, not medical or safety advice.

## How we built it / what we learned

- `@modelcontextprotocol/sdk` 1.30.1 serves seven tools over stateless Streamable HTTP; the same SDK client drives the app's tool-call loop and bundled command-line client.
- CPSC recall search, openFDA food/drug/device enforcement and EMA's shortage JSON are normalized into one source-linked result shape. The watchlist persists to a local JSON file.
- The simulated display shows MCP traces and recall cards. Browser speech controls exist, with typed input available when speech is unsupported or permission is unavailable.
- Real integration work exposed openFDA's 404 response for zero matches, Node proxy behavior, and the SDK's SSE `initialize` response. [FRICTION.md](FRICTION.md) records reproducible steps and workarounds.
- We caught and repaired two demo blockers during exercise: generic stop-using wording on FDA drug and medical-device records, and a responsive layout that covered watchlist removal in an 800×519 viewport. [EVIDENCE.md](EVIDENCE.md) has the checks and limits.

## Required product feedback draft

| Tool/API/SDK and use | Worked well / onboarding | Needs work or workaround | Build with it again? |
|---|---|---|---|
| MCP TypeScript SDK 1.30.1 — server, client and tool schemas | A server and SDK client connected locally; seven tools returned structured content and `2025-11-25` negotiated. | The negotiated version is not exposed by a `Client` getter, so the test sends a raw `initialize`; the stateless response is SSE unless JSON mode is enabled. Express middleware for host/origin validation did not fit this plain `node:http` server, so we implemented an origin check. | Yes: the server and client interoperate. A transport-neutral validation example and a version getter would help. |
| US CPSC Recall API — product search | Keyless JSON and dated source links worked in the live check. | `ProductName` can return broad matches: a “stroller” search also returned stroller bags and doll strollers. The UI therefore shows full titles and source links rather than claiming ownership of a specific model. | Yes, with careful query and notice verification. |
| openFDA enforcement API — food, drug, device | Keyless category search, date filters and recall numbers worked in the live check. | An empty search returns 404 instead of an empty `results` list; we handle that explicitly. A recall number links to an API record, not a human-readable notice page. | Yes, with the 404 and medical-care disclaimer handled. |
| EMA shortage JSON — EU medicine shortages | The live file parsed into dated entries with EMA links. | The full file needs validation and caching; repeated downloads were rate-limited during development. We cache it for one hour. | Yes, for shortage context, while keeping it distinct from a recall. |
| Browser Web Speech API — push-to-talk and spoken reply | Typed input and scripted browser walkthrough worked. | Microphone, speech recognition and speaker output are **not yet verified on a real device**, so this feedback must be completed after capture. | Decision pending real-device check. |
| OpenAI Chat Completions API — model tool calls | Fixture-shaped responses and a multi-step tool loop pass locally. | The available key returned HTTP 401 `invalid_api_key` in the parent's read-only check. We made no live model call; complete this row after a valid key is supplied and exercised. | Decision pending live check. |

**Onboarding summary:** `npm ci && MODEL_PROVIDER=scripted npm start` brings up the keyless judge path; a clean package install and Docker build were also exercised locally. The app needs no special Alexa+ device access for its simulated front end. Do not describe an actual Alexa+ device run.

## Submission and reviewer access checklist

The [official rules](https://amazonappdev2026.devpost.com/rules) were read on 2026-09-27. They require a repository URL, setup instructions, a video **under three minutes** made publicly visible on YouTube or Vimeo, product feedback for each tool/API/SDK used, and an Alexa+ track selection. An optional friction log can earn up to a 10% bonus. Deadline: **2026-10-23 12:00 PT (19:00Z)**.

Choose one repository path before submitting:

- Public: make the repository public with the open-source `LICENSE` visible on the repository page, after mgrin's go-ahead.
- Private: share with `testing@devpost.com` **and** the Amazon team named in the current rules: `chris-trag`, `knmeiss`, `giolaq`, `anishamalde`, `mosesroth`, `emersonsklar`. These invitations have not been sent.

Pending human acts: valid OpenAI key; live model and mic/speaker checks; approved media capture workflow and public YouTube/Vimeo upload; Devpost registration and submission; repository access choice and permissions. Do not paste this draft as if those checks already happened. Keep the Open Source mini challenge unselected until its separate public contribution exists.

## Video storyboard (target 2:35, maximum 2:59)

| Time | Picture | Narration cue |
|---|---|---|
| 0:00–0:18 | Recall Radar home screen and mode badge | “Household recalls span products, food and medicine. Recall Radar lets an assistant check all three.” |
| 0:18–0:43 | Add “crib mattress” by verified voice input, or type it and say “typed input” | “I add the item I own to a local watchlist.” Show `watchlist_add` in the trace. |
| 0:43–1:22 | Ask “Has anything in my house been recalled?” | “The assistant checks public sources now.” Show `check_my_household`, the dated CPSC match, hazard and remedy; open the official notice briefly. |
| 1:22–1:47 | Ask a food or medicine question | “The same tools also reach FDA and EMA data. Each result links back to its source.” Show source and date; do not advise stopping medicine. |
| 1:47–2:13 | Terminal or MCP Inspector: list seven tools, then one call | “The web experience is backed by a self-hosted MCP server over Streamable HTTP, not a painted demo.” |
| 2:13–2:35 | Return to the display and watchlist | “Checks are on demand, and the linked notice is the final source of truth.” |

### Exact capture checklist

1. First obtain a **working** model key and confirm a real multi-step answer with tool traces; never show the key. Verify mic permission, recognition, spoken output and mute on the actual recording device. If speech fails, use typed input visibly and narrate that boundary.
2. Use a fresh `WATCHLIST_PATH`, an empty watchlist, and `OPENAI_MODEL` set to the model actually verified. Show the real provider badge. Keep `MODEL_PROVIDER=scripted` only for a clearly labelled fallback clip; do not present its phrase mapping as model reasoning.
3. Before capture, run the exact crib-mattress and food/medicine questions once to ensure live source reachability and usable results. Live dates and ordering can change. Keep the official notice URL and relevant card in frame.
4. Record the existing app, MCP Inspector/CLI and actual browser speech only through the approved media workflow. Capture readable text and clear audio; trim to **<3:00**. No third-party marks, copyrighted music, fabricated voice exchange or ad hoc TTS video.
5. Review the export for factual narration, complete source/date and tool trace, no secret or personal data, correct mode badge, and total duration. Publish only after mgrin approves the media and submission steps.
