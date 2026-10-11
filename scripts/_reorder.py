# -*- coding: utf-8 -*-
import json, io

rujia_order = ["lunyu", "mengzi", "daxue-zhongyong", "xunzi", "chunqiulu"]
lixue_order = ["zhuziyulei", "chuanxilu", "taitushuo", "shirenpian", "yichuan", "zhengmeng"]
zhuzi_order = ["sunzi", "hanfeizi", "mozi", "lvshichunqiu", "zongheng", "gongsunlong", "zouyan"]

def reorder(path, order_list):
    data = json.load(io.open(path, encoding="utf-8"))
    by_id = {b["id"]: b for b in data["books"]}
    new_books = [by_id[i] for i in order_list if i in by_id]
    for b in data["books"]:
        if b["id"] not in order_list:
            new_books.append(b)
    data["books"] = new_books
    with io.open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"{path.split(chr(92))[-2]}: {[b['name'] for b in data['books']]}")

reorder(r"D:\quant\dsh_his\data\rujia\index.json", rujia_order)
reorder(r"D:\quant\dsh_his\data\lixue\index.json", lixue_order)
reorder(r"D:\quant\dsh_his\data\zhuzi\index.json", zhuzi_order)
