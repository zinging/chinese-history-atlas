# -*- coding: utf-8 -*-
import json, io, os
os.chdir(r"D:\quant\dsh_his")

# 提取每本书的核心信息供核对
for d in ["rujia", "lixue", "daojia", "foxue", "zhuzi"]:
    j = json.load(io.open(f"data/{d}/index.json", encoding="utf-8"))
    print(f"\n{'='*60}\n{d.upper()}\n{'='*60}")
    for b in j["books"]:
        print(f"\n--- {b['name']} ({b['person']}) ---")
        print(f"  meta: {b['meta']}")
        print(f"  quote: {b['quote']}")
        # timeline
        for t in b.get("timeline", []):
            print(f"  [{t.get('year','')}] {t.get('event','')} - {t.get('note','')}")
