# -*- coding: utf-8 -*-
import json, io, os
os.chdir(r"D:\quant\dsh_his")
for d in ["rujia", "lixue", "daojia", "foxue", "zhuzi"]:
    j = json.load(io.open(f"data/{d}/index.json", encoding="utf-8"))
    cases = j.get("cases", [])
    print(f"\n{d}: {len(cases)} cases")
    for c in cases:
        print(f"  - [{c['id']}] {c['name']}")
