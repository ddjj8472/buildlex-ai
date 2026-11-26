// 법리 노트 — general interpretation principles that hold across laws, each backed by a source that is
// not one of the evaluated 해석례 (scripts/eval-minwon). They state how to read a kind of provision
// (준용, 부칙의 경과조치·적용례, 행정주체에 대한 제재), never the answer to a particular inquiry.
//
// History: the first version had 10 notes written from wrong answers in the 56-case evaluation, and six of
// them were in effect answer keys for single articles (리모델링 완화, 현장관리인, 건축선 개념, 도시계획시설
// 용적률, 대피공간 면적, 제19조 용도변경 범위). Those were removed, and every source that cited an evaluated
// case was replaced by an independent one. Structural readings that code can compute from the current text
// (준용 relations, 적용 제외 lists, term definitions, 부칙 types) live in lib/structure.ts instead.
//
// A note is picked when its `when` patterns all match the question, and it goes into the legal-analysis
// prompt and the answer prompt (lib/reason.ts, lib/prompts.ts) next to the interpretation canons.

export type Doctrine = {
  id: string;
  title: string;
  /** Every pattern must match the question. */
  when: RegExp[];
  text: string;
  /** Where the rule comes from (not shown to the model). Never an evaluated 해석례. */
  source: string;
};

export const DOCTRINES: Doctrine[] = [
  {
    id: "jun-yong",
    title: "준용의 의미 — 바꿔 읽어 적용",
    when: [/준용/],
    text: "준용은 어떤 사항을 위해 만든 규정을 성질이 비슷한 다른 사항에 필요한 범위에서 바꿔 적용하는 입법기술이다. \"A에 관하여는 제X조를 준용한다\"면 제X조와 그 위임에 따른 하위 법령의 의무·절차가 A에도 적용되고, 제X조의 행위·주체·시점 문구는 A의 행위·주체·절차로 바꿔 읽는다. 그 문구가 A와 다르다는 이유만으로 A가 빠진다고 보지 않는다. 준용에서 빠지는 것은 준용 규정이 명시해 제외한 조문뿐이다.",
    source: "법제처 16-0347(준용의 정의), 법제처 「법령입안·심사기준」(준용 규정)",
  },
  {
    id: "transition-scope",
    title: "부칙의 경과조치·적용례 — 문언이 정한 대상에 한정",
    when: [/(부칙|경과조치|적용례|종전의 규정|종전 규정)/],
    text: "경과조치(\"이 법 시행 전에 …한 경우에는 종전의 규정에 따른다\")는 신법 적용의 예외이므로 그 문언이 정한 신청·행위에 한정해 적용하고, 그 밖의 신청·행위는 원칙대로 신법(개정 규정)에 따른다. 적용례(\"이 법 시행 후 최초로 …하는 경우부터 적용한다\")는 개정 규정이 처음 적용되는 대상을 정한다. 같은 건축물에 관한 것이라도 별개의 신청·처분이면 그것이 부칙 문언의 대상에 해당하는지를 따로 본다.",
    source: "법제처 「법령입안·심사기준」(부칙 — 적용례·경과조치), 법제처 11-0154(변경허가의 성질)",
  },
  {
    id: "self-sanction",
    title: "행정주체와 그 장 — 자기에게 제재처분은 못 한다",
    when: [/(지방자치단체|지자체|국가)/, /(시정명령|이행강제금|과태료|제재)/],
    text: "지방자치단체(행정주체)와 그 장(집행기관)은 구분되는 개념이다. 시정명령·이행강제금·과태료 같은 제재처분은 처분하는 기관과 의무를 지는 상대방이 다른 것을 전제로 한다. 지방자치단체의 행위는 결국 그 장이 하므로 장은 위반을 스스로 시정할 의무가 있고, 자기 지방자치단체에 금전 제재를 하면 내는 쪽과 걷는 쪽이 같아 제도의 효과가 없다. 그래서 법률에 특별한 규정이 없으면 지방자치단체의 장은 그 지방자치단체에 제재처분을 할 수 없다.",
    source: "법제처 22-1001(개발제한구역법 — 자기 지자체에 시정명령·이행강제금 불가), 질서위반행위규제법 관련 해석(자기 과태료 불가)",
  },
];

/** Notes whose patterns all match the question, most specific (most patterns) first, at most `max`. */
export function matchDoctrines(text: string, max = 3): Doctrine[] {
  return DOCTRINES.filter(d => d.when.every(r => r.test(text)))
    .sort((a, b) => b.when.length - a.when.length)
    .slice(0, max);
}

export function formatDoctrines(ds: Doctrine[]): string {
  return ds.map(d => `- ${d.title}: ${d.text}`).join("\n");
}
