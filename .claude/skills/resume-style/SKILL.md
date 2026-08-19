---
name: resume-style
description: Typographic and structural rules for the .docx resumes Orbit generates (server/pipeline/resume.ts). Use whenever changing resume rendering, layout, fonts, spacing, section order, or page length — and before adding any visual element, because ATS parsing constrains what is safe.
---

# Resume rendering rules

Orbit generates one tailored `.docx` per application in `server/pipeline/resume.ts` using the
`docx` npm package. These documents are read first by an applicant tracking system and only then
by a human, which is what constrains every decision below.

## The hard constraint: ATS parsers come first

The entire pipeline's value is keyword matching. A layout an ATS misreads costs the candidate the
match no matter how it looks to a person.

**Never add:** multi-column layouts, tables, text boxes, headers/footers, images, icons, charts,
graphics, or text in shapes. Parsers either scramble reading order or drop the content silently —
and silently is the dangerous part, because the document still looks fine when opened.

**Safe:** single-column flow, bold/italic runs, paragraph borders as section rules, tab stops for
right-aligned dates, standard bullet lists.

Some sources are federal (USAJOBS). Government and defense-contractor parsers are typically older
and stricter than commercial ones — target the strictest reader, not the average.

## Typography (decided; do not change casually)

| | Value | Why |
|---|---|---|
| Body font | Georgia | Present on Windows and macOS. Large x-height stays readable at 10.5pt. |
| Body size | 21 half-points (10.5pt) | |
| Small text | 18 half-points (9pt) | Contact line, employer/location meta |
| Name | 32 half-points (16pt), bold, caps, `characterSpacing: 40` | |
| Margins | `convertInchesToTwip(0.75)` all sides | Word's 1" default wastes a resume's most valuable space |
| Line spacing | 264 | Slightly open; readable without inflating page count |

**Always set the font explicitly** via `styles.default.document.run.font`. The `docx` package ships
no theme, so a document that names no font renders in whatever the recipient's Word defaults to —
Calibri, Aptos, or something else entirely in Google Docs or LibreOffice. Line breaks and page
count move with it, and the candidate cannot know what a recruiter sees. This was a real defect,
not a hypothetical.

## Structure

Order: name → headline → contact → Professional Summary → Core Skills → Professional Experience →
Additional Experience → Certifications → Education.

- **Headline** is `candidate.headline` — a stable professional identity line, not per-job text.
  Per-job positioning belongs in the summary.
- **Never print pipeline metadata in the document.** A "Tailored for: <job> at <company>" line was
  removed; it is useful to the candidate and reads as machine-generated to an employer.
- **Role headers are two lines**, each using a right tab stop at `US_LETTER.width - MARGIN * 2`:
  title ⇥ dates, then employer ⇥ location. This gives aligned columns without a table.
- `BULLETS_PER_ROLE` caps bullets per role; `rankBullets` selects by job-description keyword
  overlap. A larger bullet library therefore improves *selection*, not length.

## Length

Two pages is the target for commercial roles; three is defensible for 25+ years of experience and
normal for federal applications. If trimming is needed, reduce `BULLETS_PER_ROLE` before touching
type size or margins — fewer, better-matched bullets beat cramped ones.

## Verifying a change

There is no image tooling in this environment, so render and inspect instead of assuming:

```bash
libreoffice --headless -env:UserInstallation=file:///tmp/lo-render \
  --convert-to pdf --outdir <dir> <file>.docx     # page count
```

Then extract the text back through `server/documents/extract-text.ts` to confirm reading order and
that no metadata leaked in. Inspecting `word/document.xml` and `word/styles.xml` from the `.docx`
zip confirms fonts, margins, and tab stops actually landed.

**Always generate against two different job postings** and diff the selected bullets. Identical
output means ranking is not working, which no amount of styling will fix.
