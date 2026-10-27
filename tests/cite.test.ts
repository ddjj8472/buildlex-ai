import assert from "node:assert/strict";
import { test } from "node:test";
import { missingLaws, parseCitations } from "../lib/cite.ts";
import { excerpt } from "../lib/prompts.ts";
import { parseAddenda } from "../scripts/build-corpus.ts";

const KEYS = new Set(["건축법", "건축법시행령", "건축법시행규칙", "주차장법", "주차장법시행령", "국토의계획및이용에관한법률"]);
const ids = (t: string) => parseCitations(t, KEYS).map(c => c.id);

test("question citations resolve 「」, 같은 법 시행령, 영, unbracketed names and 항·호", () => {
  const c = parseCitations("「건축법」 제19조제7항에 따라 같은 법 시행령 제14조제4항제1호를 적용할 때, 영 제3조의2는 …", KEYS);
  assert.deepEqual(c.map(x => x.id), ["건축법#19", "건축법시행령#14", "건축법시행령#3의2"]);
  assert.deepEqual(c[0].paras, [7]);
  assert.deepEqual([c[1].paras, c[1].items], [[4], [1]]);
  assert.deepEqual(ids("주차장법 시행령 제6조제1항 별표 1에서"), ["주차장법시행령#6"]);
  assert.deepEqual(ids("「건축법 시행령」 별표 1 제2호"), ["건축법시행령#별표1"]);
  assert.deepEqual(ids("「담배사업법 시행규칙」 제7조"), []);
});

test("부칙 citations only when the question is about 적용례·경과조치", () => {
  const q = "2018년 8월 14일 법률 제15721호로 일부개정된 「건축법」 부칙 제2조의 적용례에 따라 개정 규정을 적용하는지?";
  assert.ok(ids(q).includes("건축법#부칙15721"));
  assert.ok(!ids("법률 제15721호로 일부개정된 「건축법」 제11조에 따라 허가를 받으려는 경우").some(x => x.includes("부칙")));
});

test("laws the corpus lacks are reported, ordinary nouns are not", () => {
  assert.deepEqual(missingLaws("「담배사업법」 제16조 및 「건축법」 제19조, 「지침」", KEYS), ["담배사업법"]);
});

test("excerpt keeps the cited 항 of a long article instead of the head only", () => {
  const paras = Array.from({ length: 12 }, (_, i) => `${"①②③④⑤⑥⑦⑧⑨⑩⑪⑫"[i]} 제${i + 1}항 본문 ${"가나다라".repeat(40)}`);
  const text = ["[제19조] 용도변경", ...paras].join("\n");
  const out = excerpt(text, 700, "", { paras: [11], items: [] });
  assert.ok(out.startsWith("[제19조]"));
  assert.ok(out.includes("⑪ 제11항"));
  assert.ok(out.includes("…"));
  assert.ok(out.length <= 900);
  assert.equal(excerpt("짧은 조문", 700), "짧은 조문");
});

test("parseAddenda keeps own-law 부칙 and drops 타법개정 blocks", () => {
  const sec = [
    "",
    "부칙 <제15721호,2018.8.14>",
    "제1조(시행일) 이 법은 공포 후 6개월이 경과한 날부터 시행한다.",
    "제2조(적용례) 제11조의 개정규정은 이 법 시행 이후 허가를 신청하는 경우부터 적용한다.",
    "부칙(주택법) <제13805호,2016.1.19>",
    "제1조(시행일) 이 법은 2016년 8월 12일부터 시행한다.",
  ].join("\n");
  const a = parseAddenda(sec);
  assert.equal(a.length, 1);
  assert.equal(a[0].key, "부칙15721");
  assert.equal(a[0].path, "부칙");
  assert.ok(a[0].text.includes("적용례"));
});
