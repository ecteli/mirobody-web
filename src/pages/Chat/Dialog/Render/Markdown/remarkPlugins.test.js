import { describe, it, expect } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import { toString } from "mdast-util-to-string";
import { remarkPlugins } from "./remarkPlugins";

// The tree react-markdown renders, before it becomes HTML.
const parse = (text) => {
  const processor = unified().use(remarkParse).use(remarkPlugins);
  return processor.runSync(processor.parse(text));
};

const struck = (tree) => {
  const out = [];
  const walk = (node) => {
    if (node.type === "delete") out.push(toString(node));
    (node.children || []).forEach(walk);
  };
  walk(tree);
  return out;
};

describe("remarkPlugins", () => {
  // Cut from a liver-panel answer (2026-11-13): a Chinese lab report writes a
  // reference range with one tilde, and two ranges in a sentence used to strike
  // through everything between them.
  it("leaves a reference range written with a single tilde as text", () => {
    const text = "肝功 7 项：谷丙转氨酶 11 U/L（7~40）、谷草转氨酶 16 U/L（13~35），均在范围内。";
    const tree = parse(text);
    expect(struck(tree)).toEqual([]);
    expect(toString(tree)).toBe(text);
  });

  it("still strikes through text between double tildes", () => {
    expect(struck(parse("二甲双胍 ~~500 mg~~ 改为 850 mg，范围 3.9~6.1"))).toEqual(["500 mg"]);
  });
});

// Every node of `type` in the tree, with its parent's type.
const nodesOf = (tree, type) => {
  const out = [];
  const walk = (node, parent) => {
    if (node.type === type) out.push({ node, parent: parent?.type });
    (node.children || []).forEach((child) => walk(child, node));
  };
  walk(tree);
  return out;
};

describe("<br> in an answer (mirobody-web#35)", () => {
  // A GFM table cell is one line; models break it with <br>, which used to
  // reach the page as the four characters `<br>`.
  it("breaks the line in table cells, in every spelling", () => {
    const tree = parse(
      "| 指标 | 2024-06-15<br>仁和市第一医院 | 2026-01-18<br/>青禾健康体检中心 |\n" +
        "| --- | --- | --- |\n" +
        "| 总胆固醇 | 5.2 mmol/L | 4.8 mmol/L<BR />（复查） |",
    );
    expect(nodesOf(tree, "break").map((b) => b.parent)).toEqual(["tableCell", "tableCell", "tableCell"]);
    expect(nodesOf(tree, "html")).toEqual([]);
  });

  it("breaks the line in a paragraph", () => {
    const tree = parse("第一行<br />第二行");
    expect(nodesOf(tree, "break").map((b) => b.parent)).toEqual(["paragraph"]);
  });

  it("gives a <br> on a line of its own a paragraph, where a break may stand", () => {
    const tree = parse("上文\n\n<br>\n\n下文");
    expect(nodesOf(tree, "break").map((b) => b.parent)).toEqual(["paragraph"]);
    expect(nodesOf(tree, "html")).toEqual([]);
  });

  it("leaves every other tag as raw html, which the page prints as text", () => {
    // Inline: a line that starts with a tag would be one html block instead.
    const tree = parse('看 <script>x</script> <b>粗</b> a<br class="x">b <img src=x onerror=alert(1)>');
    expect(nodesOf(tree, "break")).toEqual([]);
    expect(nodesOf(tree, "html").map((h) => h.node.value)).toEqual([
      "<script>",
      "</script>",
      "<b>",
      "</b>",
      '<br class="x">',
      "<img src=x onerror=alert(1)>",
    ]);
  });

  it("leaves <br> inside code alone", () => {
    const tree = parse("用 `<br>` 换行\n\n```\n<br>\n```");
    expect(nodesOf(tree, "break")).toEqual([]);
    expect(nodesOf(tree, "inlineCode")[0].node.value).toBe("<br>");
    expect(nodesOf(tree, "code")[0].node.value).toBe("<br>");
  });
});
