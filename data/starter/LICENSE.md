# LingoLens Starter EN–VI dataset

**Origin:** hand-written for the LingoLens project (files `words.txt`, `phrases.txt`).
No entries were copied from commercial or copyrighted dictionaries.

**Status:** *curated starter data – not reviewed by professional lexicographers.*
It covers common words and expressions found in fiction and manga dialogue; it is **not** a
complete dictionary and may contain mistakes. The extension labels every Vietnamese meaning from
this dataset with the source "LingoLens Starter".

**Licence:** CC0 1.0 Universal (public domain dedication). You may copy, modify and redistribute
it without restriction. https://creativecommons.org/publicdomain/zero/1.0/

## Format

`words.txt` – one sense per line:

```
word|pos|nghĩa 1; nghĩa 2|tags|ghi chú
```

`pos`: n, v, adj, adv, pron, det, prep, conj, interj, num, modal, aux, part, phr.
`tags` (optional, comma separated): slang, informal, vulgar, abbr, contraction, formal, archaic.

`phrases.txt` – one expression per line:

```
phrase|type|nghĩa|giải thích|ví dụ
```

`type`: phrasal, idiom, slang, expression, collocation. Placeholders: `one's` matches
my/your/his/her/its/our/their; `someone`/`something` match a pronoun or a short noun phrase.
