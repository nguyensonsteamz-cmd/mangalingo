### T1 – Quality (reference-based; higher is better)

| Model | Dir | chrF++ human refs (IWSLT+ALT, n=160) | BLEU human refs | chrF++ categories (author refs, unverified) | LaBSE adequacy proxy (ceiling = human ref) |
|---|---|---|---|---|---|
| Chrome Translator (existing provider) | en-vi | 55.61 | 37.97 | 65.00 | 0.9493 (0.9344) |
| Chrome Translator (existing provider) | vi-en | 55.63 | 34.44 | 67.10 | 0.9500 (0.9354) |
| EnViT5 (reference only) | en-vi | 55.80 | 38.11 | 62.18 | 0.9432 (0.9344) |
| EnViT5 (reference only) | vi-en | 59.77 | 38.49 | 57.12 | 0.9421 (0.9354) |
| M2M-100 418M | en-vi | 50.89 | 32.11 | 57.02 | 0.9490 (0.9344) |
| M2M-100 418M | vi-en | 53.33 | 30.67 | 57.28 | 0.9476 (0.9354) |
| OPUS-MT | en-vi | 44.45 | 26.75 | 36.78 | 0.9220 (0.9344) |
| OPUS-MT | vi-en | 53.65 | 32.31 | 52.80 | 0.9400 (0.9354) |

### T2 – Quality by sentence category (chrF++, author-written references – unverified)

| Model | Dir | short | conversation | idiom | technical | academic | context | format |
|---|---|---|---|---|---|---|---|---|
| Chrome Translator (existing provider) | en-vi | 63.3 | 61.6 | 43.3 | 78.6 | 76.8 | 62.6 | 63.6 |
| Chrome Translator (existing provider) | vi-en | 66.9 | 67.1 | 25.7 | 80.9 | 69.6 | 77.4 | 86.3 |
| EnViT5 (reference only) | en-vi | 75.3 | 53.7 | 53.6 | 64.1 | 81.8 | 57.3 | 50.8 |
| EnViT5 (reference only) | vi-en | 49.9 | 57.0 | 15.6 | 77.6 | 69.6 | 77.7 | 53.3 |
| M2M-100 418M | en-vi | 64.0 | 48.8 | 33.5 | 77.3 | 70.3 | 45.8 | 53.6 |
| M2M-100 418M | vi-en | 60.2 | 40.6 | 23.1 | 79.6 | 68.0 | 58.3 | 70.3 |
| OPUS-MT | en-vi | 44.4 | 53.0 | 31.2 | 26.6 | 26.8 | 59.0 | 19.9 |
| OPUS-MT | vi-en | 41.6 | 58.8 | 15.5 | 73.6 | 55.7 | 75.5 | 50.0 |

### T3 – Long text (1,486-character story, 4 paragraphs)

| Model | Dir | chunked chrF++ | glossary recall % | chunked time s | chars/s | whole text in ONE call: output / reference length |
|---|---|---|---|---|---|---|
| Chrome Translator (existing provider) | en-vi | 71.9 | 86 | 0.3 | 5824 | 1.04 |
| Chrome Translator (existing provider) | vi-en | 74.5 | 100 | 0.3 | 5430 | 0.99 |
| EnViT5 (reference only) | en-vi | 70.4 | 100 | 4.5 | 338 | 1.05 |
| EnViT5 (reference only) | vi-en | 77.0 | 100 | 3.9 | 386 | 0.99 |
| M2M-100 418M | en-vi | 55.3 | 57 | 51.0 | 30 | 0.53 |
| M2M-100 418M | vi-en | 62.8 | 71 | 37.2 | 40 | 0.75 |
| OPUS-MT | en-vi | 51.6 | 57 | 9.4 | 162 | 0.44 |
| OPUS-MT | vi-en | 65.0 | 86 | 8.7 | 171 | 0.16 |

### T4 – Performance (dev machine, CPU only; see environment)

| Model | Dir | download MB | disk MB | cold start s | p50 s | p95 s | avg s | chars/s | peak RSS MB | RSS after load MB | CPU % (all cores) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Chrome Translator (existing provider) | en-vi | built in | n/a | 14.00 | 0.023 | 0.048 | 0.025 | 4034 | n/a | n/a | n/a |
| Chrome Translator (existing provider) | vi-en | built in | n/a | 6.70 | 0.023 | 0.048 | 0.025 | 4502 | n/a | n/a | n/a |
| EnViT5 (reference only) | en-vi | 305 | 305 | 1.56 | 0.266 | 0.621 | 0.314 | 327 | 1202 | 731 | 58 |
| EnViT5 (reference only) | vi-en | 305 | 305 | 1.52 | 0.242 | 0.556 | 0.276 | 406 | 1140 | 730 | 59 |
| M2M-100 418M | en-vi | 610 | 610 | 5.35 | 3.907 | 8.917 | 4.252 | 24 | 2696 | 2041 | 47 |
| M2M-100 418M | vi-en | 610 | 610 | 3.82 | 2.271 | 5.175 | 2.627 | 43 | 2679 | 2046 | 49 |
| OPUS-MT | en-vi | 102 | 102 | 1.28 | 0.626 | 1.425 | 0.706 | 146 | 604 | 483 | 53 |
| OPUS-MT | vi-en | 102 | 102 | 1.24 | 0.557 | 1.315 | 0.652 | 172 | 592 | 481 | 53 |

### T5 – Weighted selection (only candidates with a verified commercial licence, measured in both directions)

| Model | weighted score | quality | latency | RAM | size | compat | long text | meets minimums |
|---|---|---|---|---|---|---|---|---|
| OPUS-MT | **65** | 0 | 100 | 100 | 100 | 100 | 100 | yes |
| M2M-100 418M | **38.3** | 100 | 0 | 0 | 0 | 33 | 0 | NO |
