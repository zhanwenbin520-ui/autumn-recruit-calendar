/* 渲染测试桩模板（vibecoding 第四道闸门：渲染闸）
   作用：在没有浏览器的环境下，把页面的主脚本放进一个"假 DOM"里完整执行一遍，
   用于捕捉运行时异常（未定义变量、类型错误、渲染中断等）。

   用法：
   1. 复制本文件，按你页面的实际情况替换【标记】处
   2. node render-test.js
   3. 输出 "init+render 执行完成，无异常" 即通过；
      若渲染产物长度为 0 或抛异常，说明页面会白屏/坏掉，禁止上线。

   来源：北京高校秋招日历项目（此桩曾拦下"变量名笔误导致全页空白"事故） */
const fs = require("fs"), vm = require("vm");

// ---- DOM 桩：按需补充你的页面会用到的方法 ----
function fakeEl(id) {
  const el = {
    id: id || "", children: [], style: {}, dataset: {}, value: "", innerHTML: "",
    textContent: "", className: "", disabled: false, title: "",
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute() {}, getAttribute() { return null; },
    appendChild(c) { this.children.push(c); },
    addEventListener() {}, focus() {},
    querySelector() { return fakeEl(); },
    querySelectorAll() { return []; },
  };
  return el;
}
const store = {}; // getElementById 的元素按 id 缓存，测试后可检查渲染产物
global.document = {
  getElementById: (id) => (store[id] = store[id] || fakeEl(id)),
  createElement: (t) => fakeEl(t),
  querySelectorAll: () => [],
  querySelector: () => fakeEl(),
  addEventListener() {},
  activeElement: { tagName: "BODY" },
  body: fakeEl("body"),
  documentElement: fakeEl("html"),
};
global.window = {
  scrollY: 0, pageYOffset: 0, addEventListener() {}, scrollTo() {},
  matchMedia: () => ({ matches: false }),
};
global.localStorage = { getItem: () => null, setItem() {} };
global.location = {};
global.requestAnimationFrame = (f) => setTimeout(f, 0);
global.fetch = () => Promise.resolve({ text: () => Promise.resolve("") });
global.navigator = { clipboard: { writeText: () => Promise.resolve() } };

// ---- 载入数据文件 + 页面主脚本【按你的文件名替换】----
const sb = {};
vm.createContext(sb);
vm.runInContext(fs.readFileSync("【数据文件.js】", "utf8"), sb);

const html = fs.readFileSync("【页面.html】", "utf8");
const js = html.match(/<script>([\s\S]*?)<\/script>/g)
  .map(s => s.replace(/<\/?script>/g, ""))
  .sort((a, b) => b.length - a.length)[0]; // 取最大的内联脚本

const ctx = vm.createContext(Object.assign(sb, {
  document: global.document, window: global.window, localStorage: global.localStorage,
  location: global.location, requestAnimationFrame: global.requestAnimationFrame,
  setTimeout, clearTimeout, setInterval, clearInterval,
  fetch: () => Promise.resolve({ text: () => Promise.resolve("") }),
  navigator: global.navigator,
}));

// ---- 执行 init + render ----
try {
  vm.runInContext(js, ctx, { timeout: 30000 });
  console.log("init+render 执行完成，无异常");
} catch (e) {
  console.log("渲染异常:", e.message);
  process.exit(1);
}

// ---- 产物检查【按你的页面替换渲染容器 id 与期望标记】----
const cal = store["【渲染容器id】"];
const len = (cal && cal.innerHTML || "").length;
console.log("渲染容器 innerHTML 长度:", len, len > 0 ? "✓" : "✗ 产物为空");
// 建议追加：统计关键标记出现的次数（如卡片数、列表项数），与预期对比
process.exit(0); // 若你的页面注册了定时器，需要显式退出
