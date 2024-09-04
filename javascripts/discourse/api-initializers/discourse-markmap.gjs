import { withPluginApi } from "discourse/lib/plugin-api";
import InsertMarkmap from "../components/modal/insert-markmap";
import { cleanupTableEditButtons } from "../lib/discourse/table";
import { postTextSelectionToolbar } from "../lib/fast-edit";

async function initializeMarkmap(api) {
  const modalService = api.container.lookup("service:modal");
  const markmapManager = api.container.lookup("service:markmap-manager");
  const markmapInstance = api.container.lookup("service:markmap-instance");

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
    const isPreview = markmapManager.isPreview(element);

    if (!helper && !isPreview) {
      return;
    }

    const key =
      helper && !isPreview ? `post_${helper.getModel().id}` : "composer";

    const attrs = helper?.widget.attrs || {};
    markmapManager.applyMarkmaps(element, key, isPreview, attrs);
  });

  api.modifyClass(
    "component:post-text-selection-toolbar",
    postTextSelectionToolbar
  );

  api.onPageChange(() => {
    markmapManager.clear();
    markmapInstance.clear();
  });

  api.cleanupStream(cleanupTableEditButtons);
}

export default {
  name: "discourse-markmap",

  initialize() {
    withPluginApi("1.32.0", initializeMarkmap);
  },
};
