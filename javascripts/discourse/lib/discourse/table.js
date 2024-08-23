import SpreadsheetEditor from "discourse/components/modal/spreadsheet-editor";
import { ajax } from "discourse/lib/ajax";
import { popupAjaxError } from "discourse/lib/ajax-error";
import { parseAsync } from "discourse/lib/text";
import { tokenRange } from "discourse/lib/utilities";

// Same as core.
function generateSpreadsheetModal() {
  const tableIndex = this.tableIndex;

  return ajax(`/posts/${this.id}`, { type: "GET" })
    .then((post) => {
      parseAsync(post.raw).then((tokens) => {
        const allTables = tokenRange(tokens, "table_open", "table_close");
        const tableTokens = allTables[tableIndex];

        this.modalService.show(SpreadsheetEditor, {
          model: {
            post,
            tableIndex,
            tableTokens,
          },
        });
      });
    })
    .catch(popupAjaxError);
}

// Similar as core.
function cleanupTableEditButtons() {
  document
    .querySelectorAll("svg.markmap .open-popup-link.btn-edit-table")
    .forEach((button) => {
      button.removeEventListener("click", generateSpreadsheetModal);
    });
}

export { generateSpreadsheetModal, cleanupTableEditButtons };
