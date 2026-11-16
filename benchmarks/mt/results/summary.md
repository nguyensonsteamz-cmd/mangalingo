| model | dtype | dir | chrF++ (verified refs) | BLEU (verified refs) | chrF++ (categories*) | LaBSE adequacy | p50 s | p95 s | cold s | disk MB | peak RSS MB |
|---|---|---|---|---|---|---|---|---|---|---|---|
| chrome-translator | n/a | en-vi | 55.61 | 37.97 | 65 | 0.9493 | 0.023 | 0.048 | 14 | n/a | n/a |
| chrome-translator | n/a | vi-en | 55.63 | 34.44 | 67.1 | 0.95 | 0.023 | 0.048 | 6.7 | n/a | n/a |
| envit5 | q8 | en-vi | 55.8 | 38.11 | 62.18 | 0.9432 | 0.266 | 0.621 | 1.56 | 305 | 1202 |
| envit5 | q8 | vi-en | 59.77 | 38.49 | 57.12 | 0.9421 | 0.242 | 0.556 | 1.52 | 305 | 1140 |
| m2m100-418m | q8 | en-vi | 50.89 | 32.11 | 57.02 | 0.949 | 3.907 | 8.917 | 5.35 | 610 | 2696 |
| m2m100-418m | q8 | vi-en | 53.33 | 30.67 | 57.28 | 0.9476 | 2.271 | 5.175 | 3.82 | 610 | 2679 |
| opus-mt | q8 | en-vi | 44.45 | 26.75 | 36.78 | 0.922 | 0.626 | 1.425 | 1.28 | 102 | 604 |
| opus-mt | q8 | vi-en | 53.65 | 32.31 | 52.8 | 0.94 | 0.557 | 1.315 | 1.24 | 102 | 592 |
| undefined | undefined | undefined | FAILED: undefined |||||||||
