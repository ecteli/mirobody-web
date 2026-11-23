/**
 * A person's name from the 名 / 姓 fields of the add-member form.
 *
 * The form always joined them given-name first with a space, so 名 雪 and
 * 姓 郑 were saved as "雪 郑" and the care circle drew 雪 as the avatar
 * (thetahealth/mirobody#339). Chinese, Japanese and Korean names are written
 * family name first and run together: 郑雪, 山田太郎, 김민수.
 *
 * The order follows the script of the name, not the UI language: a Chinese
 * name typed in the English UI is still 郑雪, and "John" / "Smith" typed in the
 * Chinese UI is still "John Smith".
 */

// Han, kana and Hangul, plus the marks that live inside such names
// (々 repeats a kanji, ー lengthens a kana vowel, ・ separates katakana words).
const FAMILY_FIRST_SCRIPT =
  /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}々ー・]+$/u;

const writesFamilyFirst = (part) => FAMILY_FIRST_SCRIPT.test(part);

/** The one name stored for a member, from the form's given and family names. */
export const fullName = (given = "", family = "") => {
  const g = String(given).trim();
  const f = String(family).trim();
  if (!g || !f) return f || g;
  if (writesFamilyFirst(g) && writesFamilyFirst(f)) return `${f}${g}`;
  return `${g} ${f}`;
};

/** Whether the form asks for 姓 before 名: in the languages that write it first. */
export const asksFamilyNameFirst = (language = "") => /^(zh|ja|ko)\b/i.test(String(language));
