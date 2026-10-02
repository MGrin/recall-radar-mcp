# Devpost submission draft — do not submit yet

- **Primary track:** Alexa+
- **Project:** Recall Radar
- **Tagline:** Ask about household recalls, keep a watchlist, and follow every answer to its public source.
- **Entrant:** Nikita Grishin Limited (Devpost registration pending mgrin)
- **Repository:** <https://github.com/MGrin/recall-radar-mcp> (currently private)
- **Mini challenges:** None claimed here. The separate recall-feeds Open Source mini-challenge work is pending; do not select it until a qualifying public contribution exists. No AWS Builder claim.

## Project description

“Has anything in my house been recalled?” is a hard question to answer from memory. Recall Radar gives a household assistant a watchlist and seven MCP tools to check public US product, food, device and drug recall records, plus European medicine shortages. A person can add a crib mattress, ask about their household, and see the matching notice with its date, hazard, remedy and official link.

The entry runs a self-hosted MCP server over Streamable HTTP using MCP protocol version `2025-11-25`. Its TypeScript server imports and calls the MCP SDK at runtime. A companion web app simulates a smart display: it shows the answer, source cards, transcript and each MCP tool call. The app also has browser speech controls and typed input. The watchlist is stored locally and checked on request; it does not send automatic alerts.

We built this during the hackathon window. CPSC, openFDA and EMA need no API key. A deterministic, visibly labelled scripted mode lets a judge run the real MCP tools and live public data without a model account. With an OpenAI key, a model (`gpt-6-luna`) drives the same tools through an agent loop; we ran that live, and the demo video shows it. The video's questions are entered from the page address rather than spoken: microphone and speaker were not tested, and its narration is a synthetic voice. This is a simulated Alexa+ experience; no Alexa+ device connection is claimed.

The most useful design choice is provenance: a spoken headline stays short, while each card carries the source URL and date. If an upstream fails, the response reports a warning. Medicine text tells users to consult a pharmacist or doctor before changing treatment. This is an on-demand information aid, not medical or safety advice.

## How we built it / what we learned

- `@modelcontextprotocol/sdk` 1.30.1 serves seven tools over stateless Streamable HTTP; the same SDK client drives the app's tool-call loop and bundled command-line client.
- CPSC recall search, openFDA food/drug/device enforcement and EMA's shortage JSON are normalized into one source-linked result shape. The watchlist persists to a local JSON file.
- The simulated display shows MCP traces and recall cards. Browser speech controls exist, with typed input available when speech is unsupported or permission is unavailable.
- Real integration work exposed openFDA's 404 response for zero matches, Node proxy behavior, and the SDK's SSE `initialize` response. [FRICTION.md](FRICTION.md) records reproducible steps and workarounds.
- The first live model call failed: `gpt-6-luna` refuses function tools on Chat Completions unless `reasoning_effort` is `none`. Our fixture tests had passed. The same day CPSC's product-name filter answered 503, so the server now falls back to a date listing and filters locally.
- We caught and repaired two demo blockers during exercise: generic stop-using wording on FDA drug and medical-device records, and a responsive layout that covered watchlist removal in an 800×519 viewport. [EVIDENCE.md](EVIDENCE.md) has the checks and limits.

## Required product feedback draft

| Tool/API/SDK and use | Worked well / onboarding | Needs work or workaround | Build with it again? |
|---|---|---|---|
| MCP TypeScript SDK 1.30.1 — server, client and tool schemas | A server and SDK client connected locally; seven tools returned structured content and `2025-11-25` negotiated. | The negotiated version is not exposed by a `Client` getter, so the test sends a raw `initialize`; the stateless response is SSE unless JSON mode is enabled. Express middleware for host/origin validation did not fit this plain `node:http` server, so we implemented an origin check. | Yes: the server and client interoperate. A transport-neutral validation example and a version getter would help. |
| US CPSC Recall API — product search | Keyless JSON and dated source links worked in the live check. | `ProductName` can return broad matches: a “stroller” search also returned stroller bags and doll strollers. The UI therefore shows full titles and source links rather than claiming ownership of a specific model. | Yes, with careful query and notice verification. |
| openFDA enforcement API — food, drug, device | Keyless category search, date filters and recall numbers worked in the live check. | An empty search returns 404 instead of an empty `results` list; we handle that explicitly. A recall number links to an API record, not a human-readable notice page. | Yes, with the 404 and medical-care disclaimer handled. |
| EMA shortage JSON — EU medicine shortages | The live file parsed into dated entries with EMA links. | The full file needs validation and caching; repeated downloads were rate-limited during development. We cache it for one hour. | Yes, for shortage context, while keeping it distinct from a recall. |
| Browser Web Speech API — push-to-talk and spoken reply | Typed input and the address-driven walkthrough worked. | Microphone, speech recognition and speaker output were **not verified on a real device**; a headless browser has neither. We cannot give feedback on them. | Unknown until tested on a device. |
| OpenAI Chat Completions API — model tool calls | Live with `gpt-6-luna`: parallel tool calls in one turn, short voice-shaped answers, 3–7 s per question. | The first live call answered HTTP 400: function tools need `reasoning_effort: "none"` on Chat Completions for this model. Fixture tests cannot catch that. | Yes, with that field set. |

**Onboarding summary:** `npm ci && MODEL_PROVIDER=scripted npm start` brings up the keyless judge path; a clean package install and Docker build were also exercised locally. The app needs no special Alexa+ device access for its simulated front end. Do not describe an actual Alexa+ device run.

## Submission and reviewer access checklist

The [official rules](https://amazonappdev2026.devpost.com/rules) were read on 2026-09-27. They require a repository URL, setup instructions, a video **under three minutes** made publicly visible on YouTube or Vimeo, product feedback for each tool/API/SDK used, and an Alexa+ track selection. An optional friction log can earn up to a 10% bonus. Deadline: **2026-10-23 12:00 PT (19:00Z)**.

Choose one repository path before submitting:

- Public: make the repository public with the open-source `LICENSE` visible on the repository page, after mgrin's go-ahead.
- Private: share with `testing@devpost.com` **and** the Amazon team named in the current rules: `chris-trag`, `knmeiss`, `giolaq`, `anishamalde`, `mosesroth`, `emersonsklar`. These invitations have not been sent.

Keep the Open Source mini challenge unselected until its separate public contribution exists.

## mgrin's steps, in order (about 60 minutes in total)

Nothing below has been done. Registration, access, upload and submission are his.

1. **Watch the video draft** (5 min). File: `~/.bb/thread-storage/thr_i26k7a9cgi/recall-radar-demo/walkthrough.mp4` (2:09). Say go or list changes. A change means a re-render of about 10 minutes.
2. **Register on Devpost** (10 min). Open <https://amazonappdev2026.devpost.com>, sign in or create the account as Nikita Grishin Limited (organisation), press **Join hackathon**, accept the rules.
3. **Choose repository access** (5 min), one of:
   - Public: GitHub → `MGrin/recall-radar-mcp` → Settings → Danger Zone → Change visibility → Public. The MIT `LICENSE` is already at the root.
   - Private: Settings → Collaborators → add `testing@devpost.com` and the Amazon reviewers `chris-trag`, `knmeiss`, `giolaq`, `anishamalde`, `mosesroth`, `emersonsklar` (read access). Re-check that list against the rules page first.
4. **Upload the video** (10 min). YouTube → Create → Upload `walkthrough.mp4` → visibility **Public** (the rules require publicly visible) → title "Recall Radar — Alexa+ track demo". Copy the URL.
5. **Start the submission** (20 min). Devpost → the hackathon → **Enter a submission**:
   - Track: **Alexa+**. Mini challenges: none.
   - Name, tagline and description: paste from the top of this file.
   - "Built with": TypeScript, Node.js, Model Context Protocol, OpenAI API.
   - Repository URL, video URL.
   - Testing instructions: paste the "Clean start" block of [JUDGE_GUIDE.md](JUDGE_GUIDE.md).
   - Product feedback: paste the table above.
   - Friction log: attach or paste [FRICTION.md](FRICTION.md) (up to +10%).
6. **Press Submit** (2 min), by **2026-10-21**. The hard deadline is 2026-10-23 12:00 PT (19:00Z).
7. **Keep it reachable until judging ends** (0 min): do not make the repository private or delete the video before 2026-11-20.
8. **On a win**: W-8BEN-E and payout details (his).

Known weak points to decide on before step 5: the microphone and speaker were never tested on a real device (15 minutes on his laptop would settle it: `npm start`, open the page in Chrome, hold the mic); and the crib-mattress example ages out of the default 90-day window on 2026-11-04, before judging starts.

## Video, as rendered 2026-10-02

Script: [demo/walkthrough.toml](demo/walkthrough.toml). 2:09, twelve shots: the problem; adding two items (two `watchlist_add` calls); the household check and its CPSC card; food; medicine; the MCP layer; the limits, spoken aloud (simulated display, questions entered from the address, mic and speaker untested, synthetic narrator). To re-render, start the server on port 58640 with a fresh `WATCHLIST_PATH` and the model key, then run the studio toolkit's `walkthrough.py` on the script. Re-read the frames after every render: the data is live.
