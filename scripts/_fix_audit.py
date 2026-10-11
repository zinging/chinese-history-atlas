# -*- coding: utf-8 -*-
import json, io, os
os.chdir(r"D:\quant\dsh_his")

# 修正程颐
lx = json.load(io.open("data/lixue/index.json", encoding="utf-8"))
for b in lx["books"]:
    if b["id"] == "chengyi":
        for t in b["timeline"]:
            if "与兄程颐" in t.get("event", ""):
                t["event"] = "与兄程颢讲学洛阳"
            if "嵩阳书院、嵩阳书院" in t.get("note", ""):
                t["note"] = "在洛阳、嵩阳书院讲学三十余年"

# 修正玄奘出发年 627 -> 629
fx = json.load(io.open("data/foxue/index.json", encoding="utf-8"))
for b in fx["books"]:
    if b["id"] == "xinjing":
        for t in b["timeline"]:
            if t.get("year") == "627":
                t["year"] = "629"
                t["event"] = "偷渡出关，28 岁 ★"
                t["note"] = "贞观三年。当时北方突厥常来骚扰，边关卡得很严，玄奘混出了边关。从瓜州（今甘肃安西）出发，穿过莫贺延碛大沙漠，四天五夜没喝到一滴水，差点死在沙漠里，最后走到高昌（今新疆吐鲁番）。"

# 修正鸠摩罗什 [363] 往天竺学大乘
    if b["id"] == "jingangjing":
        for i, t in enumerate(b["timeline"]):
            if t.get("year") == "363":
                b["timeline"][i] = {
                    "year": "353",
                    "event": "往罽宾学小乘",
                    "note": "9岁随母到罽宾（今克什米尔）学小乘佛法，后回龟兹改学大乘，名闻西域。"
                }

# 修正慧能重复的672条目
for b in fx["books"]:
    if b["id"] == "liuzutanjing":
        new_tl = []
        seen_672 = False
        for t in b["timeline"]:
            if t.get("year") == "672":
                if not seen_672:
                    new_tl.append(t)
                    seen_672 = True
            else:
                new_tl.append(t)
        b["timeline"] = new_tl

io.open("data/foxue/index.json", "w", encoding="utf-8").write(
    json.dumps(fx, ensure_ascii=False, indent=2))

# 修正春秋繁露 quote
rj = json.load(io.open("data/rujia/index.json", encoding="utf-8"))
for b in rj["books"]:
    if b["id"] == "chunqiulu":
        b["quote"] = "道之大原出于天，天不变，道亦不变。"

# 修正韩非子重复
zz = json.load(io.open("data/zhuzi/index.json", encoding="utf-8"))
for b in zz["books"]:
    if b["id"] == "hanfeizi":
        # 合并 [前234] 和 [前233]
        new_tl = []
        for t in b["timeline"]:
            if t.get("year") == "前233":
                continue  # 跳过重复的
            new_tl.append(t)
        # 修改 [前234] 条目
        for t in new_tl:
            if t.get("year") == "前234":
                t["event"] = "使秦，被李斯陷害自杀 ★"
                t["note"] = "秦王见《孤愤》《五蠹》叹：「嗟乎，寡人得见此人与之游，死不恨矣！」发兵攻韩求韩非。韩非入秦后，李斯、姚贾进谗：「韩非终为韩，不为秦。」下狱。李斯送毒药逼他自杀。秦王后悔使人赦免，韩非已死。"
        b["timeline"] = new_tl

io.open("data/rujia/index.json", "w", encoding="utf-8").write(
    json.dumps(rj, ensure_ascii=False, indent=2))
io.open("data/zhuzi/index.json", "w", encoding="utf-8").write(
    json.dumps(zz, ensure_ascii=False, indent=2))
io.open("data/lixue/index.json", "w", encoding="utf-8").write(
    json.dumps(lx, ensure_ascii=False, indent=2))

print("修正完成")
print("1. 程颐: 与兄程颢讲学洛阳")
print("2. 玄奘: 出发年 629 (贞观三年)")
print("3. 鸠摩罗什: 353 往罽宾学小乘")
print("4. 春秋繁露 quote: 道之大原出于天")
print("5. 韩非子: 合并重复条目")
print("6. 慧能: 合并重复672条目")
