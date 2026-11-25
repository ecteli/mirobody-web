// The input of the picker that is open now, if any.
let pickerInput = null;

/**
 * Open the system file picker and call `onChange` with its `change` event.
 *
 * The input is put in the document while the picker is open. A detached one
 * worked on desktop and in the iOS Simulator, but on a reporter's iPhone
 * (Safari and Chrome) a photo chosen from the library never arrived and the
 * backend saw no `upload_start`; an input in the document, which they tried,
 * fixed it (thetahealth/mirobody#361). Nothing references a detached input
 * once `.click()` returns, so a browser is free to drop it, and its
 * `change`, while the picker is up. It leaves the document when the picker
 * answers, or when the next one opens, for a browser that sends no `cancel`.
 */
export const pickFiles = (accept, onChange) => {
  pickerInput?.remove();
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.accept = accept;
  input.tabIndex = -1;
  input.setAttribute("aria-hidden", "true");
  input.style.cssText =
    "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none";
  const done = () => {
    input.remove();
    if (pickerInput === input) pickerInput = null;
  };
  input.addEventListener("change", (e) => {
    onChange(e);
    done();
  });
  input.addEventListener("cancel", done);
  document.body.appendChild(input);
  pickerInput = input;
  input.click();
};
