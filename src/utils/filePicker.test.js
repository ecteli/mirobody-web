/**
 * On iOS a detached file input often lost the photo the person picked
 * (thetahealth/mirobody#361). These pin that the input is in the document
 * while the picker is open, and that it does not stay there afterwards.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

// Enough of `document` for a file input: the body records what is in it, and
// each input keeps its listeners so a test can answer for the picker.
const makeDocument = () => {
  const inBody = new Set();
  const inputs = [];
  const document = {
    body: { appendChild: (el) => inBody.add(el) },
    createElement: () => {
      const listeners = {};
      const input = {
        style: {},
        setAttribute: () => {},
        addEventListener: (type, fn) => {
          listeners[type] = fn;
        },
        remove: () => inBody.delete(input),
        click: vi.fn(() => {
          input.attachedAtClick = inBody.has(input);
        }),
        fire: (type, event = {}) => listeners[type]?.({ target: input, ...event }),
      };
      inputs.push(input);
      return input;
    },
  };
  return { document, inBody, inputs };
};

describe("pickFiles", () => {
  let pickFiles;
  let dom;

  beforeEach(async () => {
    dom = makeDocument();
    vi.stubGlobal("document", dom.document);
    vi.resetModules();
    ({ pickFiles } = await import("./filePicker.js"));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is in the document when it is clicked", () => {
    pickFiles("image/*", () => {});
    const [input] = dom.inputs;
    expect(input.click).toHaveBeenCalledOnce();
    expect(input.attachedAtClick).toBe(true);
    expect(input.accept).toBe("image/*");
    expect(input.multiple).toBe(true);
  });

  it("hands over the choice and then leaves the document", () => {
    const onChange = vi.fn();
    pickFiles("*/*", onChange);
    const [input] = dom.inputs;
    input.files = ["scan.jpg"];

    input.fire("change");

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0][0].target.files).toEqual(["scan.jpg"]);
    expect(dom.inBody.size).toBe(0);
  });

  it("leaves the document when the picker is cancelled", () => {
    const onChange = vi.fn();
    pickFiles("*/*", onChange);
    dom.inputs[0].fire("cancel");

    expect(onChange).not.toHaveBeenCalled();
    expect(dom.inBody.size).toBe(0);
  });

  it("does not pile up when the browser sends no cancel", () => {
    pickFiles("*/*", () => {});
    pickFiles("*/*", () => {});
    pickFiles("*/*", () => {});

    expect(dom.inBody.size).toBe(1);
    expect(dom.inBody.has(dom.inputs[2])).toBe(true);
  });
});
