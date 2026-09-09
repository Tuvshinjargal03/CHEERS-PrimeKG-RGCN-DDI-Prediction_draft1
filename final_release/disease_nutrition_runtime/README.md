# Disease nutrition and lifestyle runtime

`disease_nutrition.jsonl` is a small, manually reviewed UI/runtime artifact for
general disease nutrition education. Version 1 covers only these exact CHEERS
disease identities:

- `5148` — type 2 diabetes mellitus (`MONDO:0005148`)
- `5393` — gout (`MONDO:0005393`)
- `1356` — iron deficiency anemia (`MONDO:0001356`)

Hypertension is intentionally absent because its current CHEERS identity is a
grouped MONDO entity marked `needs_review`.

## Sources and review

All source pages and reuse notices were checked on 2026-09-09:

| Disease | Source | Page | Source date | Reuse notice |
| --- | --- | --- | --- | --- |
| Type 2 diabetes mellitus | NIDDK | [Healthy Living with Diabetes](https://www.niddk.nih.gov/health-information/diabetes/overview/healthy-living-with-diabetes) | Last reviewed October 2023 | [NIDDK copyright](https://www.niddk.nih.gov/copyright) |
| Gout | NIAMS | [Gout: Diagnosis, Treatment, and Steps to Take](https://www.niams.nih.gov/health-topics/gout/diagnosis-treatment-and-steps-to-take) | Last reviewed December 2023 | [NIAMS disclaimer](https://www.niams.nih.gov/disclaimer) |
| Iron deficiency anemia | NHLBI | [Anemia - Iron-Deficiency Anemia](https://www.nhlbi.nih.gov/health/anemia/iron-deficiency-anemia) | Last updated March 24, 2022 | [NIH reuse guidance](https://www.nih.gov/about-nih/frequently-asked-questions) |

The runtime stores short original CHEERS paraphrases, not copied page prose,
images, logos, or downloaded publications. Every paraphrase names the official
page section that supports it. Source links and institute names must remain
visible wherever these records are presented. Page-specific notices should be
checked again before a future artifact update.

## Scientific boundary

This artifact provides general disease nutrition education. It is not medical
nutrition therapy, a personalized meal plan, a calorie or macronutrient target,
a treatment recommendation, or a food-safety verdict. It does not combine a
person's medicines and diseases to produce diet advice. It is separate from the
openFDA medicine Food & lifestyle module and from drug-interaction checking.

An empty field means the reviewed source did not clearly support that category;
it does not imply that no relevant information exists. Diseases without a
reviewed record must return `status: unavailable`; no generic advice is inferred.

## Integrity

`DISEASE_NUTRITION_MANIFEST.json` records the schema version, artifact version,
record count, source review date, byte size, and SHA-256 fingerprint. The
`DiseaseInformationService` validates the manifest before exposing the records.
