import { getOwner } from "@ember/application";
import { later, next, schedule } from "@ember/runloop";
import FullscreenTableModal from "discourse/components/modal/fullscreen-table";
import SpreadsheetEditor from "discourse/components/modal/spreadsheet-editor";
import { ajax } from "discourse/lib/ajax";
import { popupAjaxError } from "discourse/lib/ajax-error";
import lightbox from "discourse/lib/lightbox";
import {
  LIGHTBOX_APP_EVENT_NAMES,
  SELECTORS,
} from "discourse/lib/lightbox/constants";
import loadScript from "discourse/lib/load-script";
import { withPluginApi } from "discourse/lib/plugin-api";
import { parseAsync } from "discourse/lib/text";
import { tokenRange } from "discourse/lib/utilities";
import discourseDebounce from "discourse-common/lib/debounce";
import { getOwnerWithFallback } from "discourse-common/lib/get-owner";
import I18n from "discourse-i18n";
import FullscreenMarkmap from "../components/modal/fullscreen-markmap";
import InsertMarkmap from "../components/modal/insert-markmap";
import { cleanupTableEditButtons } from "../lib/discourse/table";
//import { noop } from "../../lib/markmap/common";
import { clsActive, clsToolbarItem, Toolbar } from "../lib/markmap/toolbar";
import { Transformer } from "../lib/markmap/transform";
import { Markmap } from "../lib/markmap/view";
//import { DEBOUNCE_DELAY } from "../lib/markmap/view/constants";
import { deriveOptions } from "../lib/markmap/view/util";

async function initializeMarkmap(api) {
  const modalService = api.container.lookup("service:modal");
  const markmapManager = api.container.lookup("service:markmap-manager");

  // this is a hack as applySurround expects a top level
  // composer key, not possible from a theme
  window.I18n.translations[window.I18n.locale].js.composer.markmap_sample = ` `;

  api.addComposerToolbarPopupMenuOption({
    icon: "diagram-markmap",
    label: themePrefix("insert_markmap"),
    action: (toolbarEvent) =>
      modalService.show(InsertMarkmap, {
        model: { insertMarkmap: toolbarEvent.applySurround },
      }),
  });

  api.onToolbarCreate((toolbar) => {
    toolbar.addButton({
      title: themePrefix("insert_markmap"),
      id: "insertMarkmap",
      group: "insertions",
      icon: "diagram-markmap",
      perform: (toolbarEvent) =>
        modalService.show(InsertMarkmap, {
          model: { insertMarkmap: toolbarEvent.applySurround },
        }),
    });
  });

  api.decorateCookedElement((element, helper) => {
    const isPreview = element.classList.contains("d-editor-preview");

    if (!helper && !isPreview) {
      return;
    }

    const key =
      helper && !isPreview ? `post_${helper.getModel().id}` : "composer";

    /*if (key === "composer") {
      discourseDebounce(applyMarkmaps, element, helper, key, 0);
    } else {
      applyMarkmaps(element, helper, key, siteSettings);
    }*/

    const attrs = helper?.widget.attrs || {};
    markmapManager.applyMarkmaps(element, key, attrs);
  });

  api.cleanupStream(cleanupTableEditButtons);
}

export default {
  name: "discourse-markmap",

  initialize() {
    withPluginApi("0.10.1", initializeMarkmap);
  },
};
