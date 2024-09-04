import { action } from "@ember/object";
import { service } from "@ember/service";
import {
  getElement,
  selectedNode,
  selectedText,
} from "discourse/lib/utilities";
import escapeRegExp from "discourse-common/utils/escape-regexp";

const CSS_TO_DISABLE_FAST_EDIT = [
  "aside.quote",
  "aside.onebox",
  ".cooked-date",
  "body.encrypted-topic-page",
].join(",");

function insideMarkmap(element) {
  return (
    element.hasAttribute("xmlns") &&
    element?.parentElement?.tagName === "FOREIGNOBJECT"
  );
}

// TODO: Reduce the scope to the markmap container?
// Similar to core.
// Difference is we match with the actual post cooked, so the SVG is not included and
// to avoid duplication with the hidden [wrap] element.
function canFastEdit(data, post) {
  const { canEditPost, quoteState, supportsFastEdit } = data;

  if (supportsFastEdit || !canEditPost) {
    return false;
  }

  const _selectedText = selectedText();
  const selection = window.getSelection();

  if (selection.isCollapsed || _selectedText === "") {
    return false;
  }

  const start = getElement(selection.getRangeAt(0).startContainer);

  if (
    !start ||
    insideMarkmap(start) ||
    start.closest(CSS_TO_DISABLE_FAST_EDIT)
  ) {
    return false;
  }

  if (
    quoteState.buffer.length === 0 ||
    quoteState.buffer.includes("|") || // tables are too complex
    quoteState.buffer.match(/\n/g) // linebreaks are too complex
  ) {
    return false;
  }

  const _selectedElement = getElement(selectedNode());
  const cooked =
    _selectedElement.querySelector(".cooked") ||
    _selectedElement.closest(".cooked");

  if (!cooked) {
    return false;
  }

  const regexp = new RegExp(escapeRegExp(quoteState.buffer), "gi");
  const matches = post.cooked.match(regexp);

  return matches?.length === 1;
}

export function postTextSelectionToolbar(SuperClass) {
  return class extends SuperClass {
    @service markmapToolbar;

    @action
    async toggleFastEdit() {
      if (
        !this.markmapToolbar.contentDisplayed &&
        canFastEdit(this.args.data, this.post)
      ) {
        this.args.data.supportsFastEdit = true;
      }

      super.toggleFastEdit();
    }
  };
}
