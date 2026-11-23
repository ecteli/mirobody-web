import { describe, expect, it } from "vitest";

import { asksFamilyNameFirst, fullName } from "./personName";

describe("fullName", () => {
  it("writes a Chinese name family name first, with no space (#339)", () => {
    expect(fullName("雪", "郑")).toBe("郑雪");
    expect(fullName(" 小明 ", " 欧阳 ")).toBe("欧阳小明");
  });

  it("does the same for Japanese and Korean names", () => {
    expect(fullName("太郎", "山田")).toBe("山田太郎");
    expect(fullName("花子", "佐々木")).toBe("佐々木花子");
    expect(fullName("エミリー", "スミス")).toBe("スミスエミリー");
    expect(fullName("민수", "김")).toBe("김민수");
  });

  it("keeps a Latin-script name given name first", () => {
    expect(fullName("John", "Smith")).toBe("John Smith");
  });

  it("goes by the name's script, not the language it was typed in", () => {
    // A Chinese family name with a romanised given name is not one run of Han.
    expect(fullName("Xue", "郑")).toBe("Xue 郑");
    expect(fullName("Anna", "Müller")).toBe("Anna Müller");
  });

  it("returns the one part given when the other is empty", () => {
    expect(fullName("雪", "")).toBe("雪");
    expect(fullName("", "郑")).toBe("郑");
    expect(fullName()).toBe("");
  });
});

describe("asksFamilyNameFirst", () => {
  it("asks for 姓 first in Chinese, Japanese and Korean", () => {
    for (const lang of ["zh-CN", "zh-TW", "ja", "ko"]) expect(asksFamilyNameFirst(lang)).toBe(true);
  });

  it("asks for the given name first elsewhere", () => {
    for (const lang of ["en", "fr", "", undefined]) expect(asksFamilyNameFirst(lang)).toBe(false);
  });
});
