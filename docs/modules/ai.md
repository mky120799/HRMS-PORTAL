# AI module

`apps/server/src/modules/ai` (Gemini via `@google/genai`)

## Purpose
Resume screening (background), resume parsing for recruiters, and an HR assistant chat.

## Endpoints (plan: ENTERPRISE; available to everyone during the trial)

| Method & path | Access | Limits |
| --- | --- | --- |
| `POST /ai/chat` `{ message }` | user | ≤ 1000 chars, 20/min |
| `POST /ai/parse-resume` (multipart PDF ≤ 5 MB) | MANAGER, ADMIN | 10/min |

Screening runs in `HiringProcessor` (see [hiring.md](hiring.md)).

## Design rules
* **Disabled cleanly without `GEMINI_API_KEY`** → 503 "not configured". No mock or random
  scores (the original invented random scores and "screened" the *filename*).
* **Real input:** text is extracted from the PDF (`pdf-parse`); scanned/unsupported files are
  marked "review manually" instead of guessed.
* **Prompt-injection containment:** resume text is untrusted; it is fenced in `<resume>` tags,
  the system instruction says to ignore instructions inside it, output is forced to JSON and
  validated with zod (score clamped 0–100, lengths bounded). A malicious resume can at worst
  skew its own advisory score.
* **Fairness:** the prompt restricts scoring to skills/experience and excludes protected
  characteristics. Scores are advisory only — automated rejection would trigger obligations
  under the EU AI Act (high-risk system), NYC Local Law 144 and similar rules.
* **Chat** uses a system instruction, low temperature, token limit, and only the caller's own
  context (name, role, department, leave balances from the Leave module).
* **Resilience:** 20 s timeout; background screening retries 3× with backoff.
* Model is configurable (`GEMINI_MODEL`, default `gemini-2.5-flash`).

## Privacy note
Resume text is sent to Google's API. List Google as a sub-processor in your privacy notice and
DPA; the careers form's consent text mentions automated screening assistance.
