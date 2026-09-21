# FocusFlow 系統手冊複評版版型契約

## Reference

- Retained reference: `C:\Users\User\Documents\GitHub\focusflow\docs\00_Deliverables\System_Manual\source-documents\專題手冊_初評最終版.docx`
- SHA-256: `EE9BE1CDD7ACB8DF5957B66E8C2213579F33FF4ED044A8A6B8379DD868118F35`
- Size: 10,583,821 bytes
- Reference render: temporary QA output removed after verification
- Reference render page count: 103 pages in LibreOffice; the retained Microsoft Word PDF has 89 pages. This pagination difference is renderer-specific and is not a design change.
- Section count: 4

## Page system

- A4 portrait, 8.27 × 11.69 inches.
- All four sections use 0.59-inch top, bottom, left, and right margins.
- Sections begin on a new page.
- Front matter uses Roman page numbers; the main body uses Arabic page numbers centered in the footer.
- Existing cover, contents pages, chapters 1 to 4, chapter 12, chapter 14, appendices, headers, footers, bookmarks, footnotes, and relationships are preserve-only.

## Typography

- Chinese text uses DFKai-SB, displayed as 標楷體 in Word. Latin text uses Times New Roman.
- Chapter headings use Heading 1, 18 pt, bold, centered, black, and begin on a new page.
- Section headings use Heading 2, 16 pt, bold, left aligned, black.
- Subsection headings use Heading 3, 14 pt, black.
- Body text follows the existing Normal paragraph rhythm, 14 pt appearance, justified, with the source document's first-line indentation and line spacing.
- Captions use Caption, 14 pt, centered, black. Figure and table numbers are visible text in the body; Word field refresh is requested on open.
- No blue headings, shaded callouts, review-cover elements, or internal working-note typography may be added.

## Tables and lists

- Reuse the source's Table Grid pattern.
- Header rows use the source light green fill and black bold text.
- Borders remain black and visible; rows expand naturally and repeat the header when a table crosses pages.
- Narrative content stays in prose. Tables are used for requirements, use-case descriptions, mappings, metadata, component specifications, and test results.
- Bullets and numbered steps use the source document's existing list indentation and black text.

## Figures and captions

- Figures are centered inline images, scaled to the available text width without distortion.
- Keep each image with its following caption where possible.
- Use the current versioned image files in `docs\00_Deliverables\System_Manual\images` when a diagram was redrawn after the initial evaluation.
- The caption shown to readers omits the `-vX-x` filename suffix.
- Existing figures outside chapters 5 to 10 remain unchanged.

## Content flow and edit slots

- Preserve the cover and front matter.
- Preserve chapters 1 to 4 unchanged.
- Replace only the body range beginning at the Heading 1 paragraph `需求模型` and ending immediately before the Heading 1 paragraph `使用手冊`.
- Insert updated chapters 5 to 10 in that range.
- Preserve chapter 12, chapter 14, and appendices unchanged.
- The table of contents, list of figures, and list of tables remain Word fields. Set `w:updateFields=true` so Microsoft Word refreshes page numbers and new entries when opened.

## Chapter content contract

- Chapter 5 retains the initial requirements, use-case, use-case-description, and analysis-class structure while adding the implemented July-to-September capabilities: role-aware authentication, enrollment control, multi-video batches, conversations, citations, notifications, private avatars, Shorts, and conditional short-script and manual finished-video review flows.
- Chapter 6 uses the current nine sequence diagrams, three design class diagrams, and one design object diagram. Internal production notes, artifact versions, repository wording, and live-acceptance disclaimers do not appear in the body.
- Chapter 7 retains deployment, package, component, and state-machine sections and uses the current versioned diagrams.
- Chapter 8 retains database relationships and metadata tables, updated for the current MongoDB collections and indexes.
- Chapter 9 adds component specifications and selected short code excerpts only; it must not include full source files.
- Chapter 10 adds testing methods, cases, and results. Dates and limits may appear only when they are part of a specific test result, not as generic authoring notes.

## Writing rules

- Remove `現況基準`, `整理基準`, `本輪`, `checkout`, `repository`, `工作母稿`, `AI 協助產出`, and similar process narration from the manual body.
- Explain functions as system behavior in natural project-report prose.
- State unfinished or conditional functions locally and concretely, for example `短影音腳本功能目前預設關閉`, instead of repeating broad formal-acceptance disclaimers.
- Keep technical names only when readers need them to understand the design, database, component, or test.

## Package preservation

- Preserve source package parts not required for the chapter replacement, including styles, numbering, theme, headers, footers, footnotes, existing media, custom XML, bookmarks outside the edited range, and all relationships used by retained content.
- New chapter images may add media and relationship parts.
- Existing fields remain intact; settings may change only to request field updates.

## Fidelity gates

- The retained reference must keep the recorded SHA-256.
- The final file must be a new DOCX in `docs\00_Deliverables\System_Manual\output`.
- The complete final DOCX must render successfully with the packaged renderer.
- Every final page must be inspected for missing glyphs, clipping, table overflow, broken captions, detached figures, and header/footer drift.
- The final document must contain no internal work notes, Markdown syntax, unresolved image paths, or placeholder text.
