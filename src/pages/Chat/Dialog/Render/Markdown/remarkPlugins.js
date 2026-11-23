import remarkGfm from "remark-gfm";
import remarkCjkFriendly from "remark-cjk-friendly";

// Exactly one line-break tag, as models write it: <br>, <br/>, <br />, any case.
const BREAK_TAG = /^<br\s*\/?>$/i;

/**
 * `<br>` in an answer as a line break, and every other tag still as text.
 *
 * A GFM table cell is one line, so a model breaks it with `<br>`
 * ("2024-06-15<br>仁和市第一医院"). The parser reads that as a raw `html` node,
 * and react-markdown, with no rehype-raw, prints raw HTML as escaped text: the
 * reader saw the four characters `<br>` (mirobody-web#35). rehype-raw would
 * render every tag a model or an uploaded document writes, `<script>` and
 * `<img onerror>` included, so only an html node that is wholly one `<br>`
 * becomes an mdast `break`; anything else stays as it was.
 */
export const remarkBreakTags = () => (tree) => {
  const walk = (node) => {
    if (!node.children) return;
    node.children = node.children.map((child) => {
      if (child.type !== "html" || !BREAK_TAG.test(child.value.trim())) return child;
      // In running text or a cell it is a break. On a line of its own it is a
      // block, where a bare break is not allowed: give it a paragraph.
      const br = { type: "break", position: child.position };
      return node.type === "root" || node.type === "blockquote" || node.type === "listItem"
        ? { type: "paragraph", children: [br], position: child.position }
        : br;
    });
    node.children.forEach(walk);
  };
  walk(tree);
};

// One list for the renderer and for the citation tests: a cite anchor is
// placed on the parsed tree, so the tests must parse exactly as the page does.
export const remarkPlugins = [
  // singleTilde: GFM's default also reads a pair of SINGLE tildes as
  // strikethrough, and a Chinese lab report writes its reference ranges with
  // one: in "谷丙转氨酶 11 U/L（7~40）、谷草转氨酶 16 U/L（13~35）" everything
  // from the first `~` to the second was struck through and both tildes were
  // dropped, so the reader saw "（740）" and "（1335）". `~~text~~` still strikes.
  [remarkGfm, { singleTilde: false }],
  // cjk-friendly: CommonMark's emphasis delimiter rules treat full-width
  // punctuation as punctuation, so the ** in `**基因位点（rsID）**数据` renders
  // literally instead of as bold — and models write exactly that in Chinese
  // answers. This plugin relaxes the delimiter test for CJK text.
  remarkCjkFriendly,
  remarkBreakTags,
];
