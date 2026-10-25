# AML Case-to-Narrative Agent

A Week 3 extension of the Week 2 AML RAG project, with a local Investigation desk and a bounded n8n agent loop.

## Included

- Browser workspace for fictional parties and transactions, synthetic screening, human review, editable narratives, approval, download and analyst feedback.
- Persistent friendly Case IDs, saved Case state and chronological Audit History with Eastern Time timestamps.
- Bounded transaction analysis, screening, optional Week 2 guidance retrieval and draft generation.
- Two sanitized n8n workflow import templates, synthetic evaluation fixtures and regression tests.

## Start locally

Requires Node.js 22.9 or later. No dependencies or build step are needed.

1. Clone this repository (or extract its ZIP) and open a terminal in the project folder.
2. Run `powershell -File Setup.ps1` to create a private `.env` with a random service token.
3. Configure n8n as described below, then set the connection values in `.env`.
4. Run `node --env-file=.env server.mjs`.
5. Open http://127.0.0.1:8780/.

Saved Cases are created in `runtime/`. The local workspace does not require an access token and is restricted to this computer. Protected `/internal` routes require the service token.

## Connect n8n

The included workflow JSON files are inactive templates, not exports of private live credentials.

1. Import `n8n/SAR_01_Agent_Loop.json` and `n8n/SAR_02_Synthetic_Screening.json`.
2. Replace the `https://REPLACE-WITH-YOUR-CASE-SERVICE` URL origins with your reachable HTTPS service URL; preserve the paths and expressions.
3. For service HTTP nodes, select Header Auth with `Authorization: Bearer YOUR_SERVICE_TOKEN`, matching `.env`.
4. For Choose Next Tool, select your OpenAI credential.
5. Protect the webhook nodes with a Header Auth credential. The app dispatches `X-SAR-Key: N8N_RUN_KEY` when that setting is populated; otherwise it uses the service token as a Bearer header. Match the webhook credential to that choice.
6. Publish the workflows. Set `N8N_RUN_URL` to the production Run Case webhook and `SERVICE_PUBLIC_URL` to the service HTTPS origin. Set `N8N_RUN_KEY` if using X-SAR-Key.
7. Restart the local server.

n8n Cloud cannot reach localhost directly. The existing demo uses a temporary HTTPS tunnel; a new installation requires its own reachable URL. Keep the internal service authenticated. A temporary tunnel URL changes when replaced.

Week 2 guidance is configured through `WEEK2_ASK_URL`. It is optional and used only when selected by the agent. The Week 2 codebase is not duplicated in this package.

## Demo

Load sample Case, create a Case, and start the investigation. Resolve any potential synthetic match with reviewer name, decision and a nonempty reason; the agent resumes automatically. Review or edit the resulting narrative, approve it and download it. Audit History records actions, reviewer decisions and future export requests; it does not display costs or token counts.

Close Case returns to the empty workspace; the saved Case remains available through its system-generated ID. Find a Case by ID starts blank.

## Validation

Run `node --test tests/*.test.mjs` or `npm test`. The latest regression run passed 27 tests, covering validation, screening, review, optional DOB handling, planner sequencing, bounded failures, budgets, persistence, audit formatting and HTTP export controls. These checks are not a claim of production model accuracy.

`evaluation/cases.json` and `evaluation/evaluation-matrix.csv` contain synthetic evaluation inputs and acceptance criteria. Live execution results and saved Cases are excluded from this archive.

## Boundaries

Use fictional data only. Watchlist records are synthetic; no real sanctions screening is performed. The app prepares a factual draft and cannot file a SAR or determine criminal intent. Potential matches require human disposition, and downloads require narrative approval. Narrative edits revoke approval.

Run limits remain enforced internally: eight planner steps, token limits and an optional configured cost ceiling. Credentials, tunnels and live data must be configured separately; none are included in the archive.
