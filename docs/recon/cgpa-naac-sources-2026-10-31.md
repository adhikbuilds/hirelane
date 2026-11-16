# CGPA rule sources and the NAAC 5.2.1 template (recon 2026-10-31)

These notes come from web searches. Unless a row says "official", the source is a third-party calculator site, and the row stays `verified:false` until someone reads the university's own document. The official Anna University PDF timed out on fetch, so recheck it.

## Rules that look WRONG in cgpa-rules.json (fix before the pilot)
| id | ours | what sources say | action |
|---|---|---|---|
| vtu | (CGPA − 0.75) × 10 for all | Depends on the **scheme**. The 2015/2017/2018 schemes use (CGPA − 0.75) × 10. The 2021 and 2022 schemes use **CGPA × 10** (Regulations 2022, clause 22OB 6.7, cited by third-party sites). 2026 passouts are on the 2022 scheme. | Split the rule by scheme or admission year. Until it's verified, return "can't check: which VTU scheme?" rather than guess. |
| aktu | 10 × CGPA | **(CGPA − 0.75) × 10.** Most sources cite the B.Tech Ordinance 2018-19 §15 (one says §14). One outlier says −0.5. | Change to (CGPA − 0.75) × 10, unverified, and fetch the ordinance from aktu.ac.in. |
| mumbai | 7.1 × CGPA + 11 | 7.1x + 11 is from Circular Exam/Com/97 of 2018 (CBCS). One source claims it was **repealed from 1 Jan 2026** by Circular Exam/Result/803 of 2026, with conversion from raw marks instead. Engineering may differ. | Mark as disputed. Check on mu.ac.in. If repealed, return "can't check: use the percentage on your marksheet". |

## Rules that look right (not yet verified against the university's own document)
- **anna, 10 × CGPA: official.** acoe.annauniv.edu/download_forms/student_forms/CGPA_TO_PERCENTAGE_CONVERSION.pdf, Lr.No. 3452/AU/CAC/CGPA2020 dated 29.12.2020. It covers UG and PG under R-2015, R-2018 and R-2019, and comes from the University Departments office. R2021 and affiliated colleges are unconfirmed.
- **jntuh, (CGPA − 0.5) × 10:** Clause 11.2 of the B.Tech regulations R16/R18/R22, quoted by many sites. Third-party sources only.

## NAAC 5.2.1 (our CSV export)
- **Revised framework (Jan 2023, affiliated colleges):** 5.2.1 combines placement **and** progression to higher education: "Percentage of placement of outgoing students and students progressing to higher education during the last five years". The denominator is outgoing students (Extended Profile 2.3).
- **Universities manual:** placement is 5.2.2, a separate metric. Our export must say which manual it follows.
- **Usual template columns (unconfirmed, check the official data template):**
  - placement part: Year | Name of student placed and contact details | Program graduated from | Name of the employer with contact details | Pay package at appointment
  - higher-education part: Name of student | Program graduated from | Institution joined | Programme admitted to
- **Gaps in ours** (`name, programme, employer, package_lpa, verified_on`): no year column, no employer contact, and no higher-education section. The outcomes screen also needs a higher-studies outcome.

## Sources
- VTU: https://knwdle.com/tools/vtu-cgpa-to-percentage-calculator , https://www.cgpaconverter.in/blog/vtu-cgpa-calculator-guide.html
- AKTU: https://knwdle.com/tools/aktu-cgpa-to-percentage-calculator , https://academic.exammint.in/tools/aktu-cgpa-to-percentage-calculator/
- Anna (official): https://acoe.annauniv.edu/download_forms/student_forms/CGPA_TO_PERCENTAGE_CONVERSION.pdf
- Mumbai: https://gradekar.com/cgpa-to-percentage/mumbai-university , https://knwdle.com/tools/mumbai-university-cgpa-to-percentage-calculator
- JNTUH: https://scholarkit.org/tools/cgpa-calculator/jntu/ , https://mycgpatopercentage.in/jntuh-cgpa-to-percentage
- NAAC: https://www.mccollege.edu.in/upload/criteria/1678847657.pdf , https://www.unishivaji.ac.in/uploads/naac/2026/may/04-May/SSR-Template.pdf , https://naac.iem.edu.in/ssr-criterion-5-2/
