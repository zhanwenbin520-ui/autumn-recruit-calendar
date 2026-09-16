#!/usr/bin/env node
/* 版本号推导工具：按【今天日期】+ 既有更新日志自动计算下一个版本号。
   用法：node bump-version.mjs  （在本文件所在目录运行）
   规则：V{月}.{日}.{当日序号}，杜绝跨零点后手工递增旧序列的事故 */
import fs from "fs";
import path from "path";
import url from "url";
const f = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "events.js");
let s = fs.readFileSync(f, "utf8");
const now = new Date();
const prefix = "V" + (now.getMonth() + 1) + "." + now.getDate() + ".";
let max = 0, m;
const re = /"(V\d+\.\d+\.\d+)"/g;
while ((m = re.exec(s))) if (m[1].startsWith(prefix)) max = Math.max(max, parseInt(m[1].split(".")[2], 10));
const ver = prefix + (max + 1);
const decl = 'var DATA_VERSION = "' + ver + '";';
if (s.includes(decl)) {
  console.log("已是最新版本", ver, "（如需实际递增，请先补充本次改动说明）");
  process.exit(0);
}
s = s.replace(/var DATA_VERSION = "[^"]+";/, decl);
fs.writeFileSync(f, s);
console.log("版本已推导 →", ver);
