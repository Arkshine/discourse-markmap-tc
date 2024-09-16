import { setOwner } from "@ember/owner";
import { service } from "@ember/service";
import { withPluginApi } from "discourse/lib/plugin-api";
import OptionsMarkmap from "../components/modal/options-markmap";
import { cleanupTableEditButtons } from "../lib/discourse/table";
import { postTextSelectionToolbar } from "../lib/fast-edit";

class MarkmapInit {
  @service modal;
  @service router;
  @service markmapManager;
  @service markmapInstance;

  constructor(owner) {
    setOwner(this, owner);

    withPluginApi("1.32.0", (api) => {
      // This is a hack as applySurround expects a top level
      // composer key, not possible from a theme.
      window.I18n.translations[
        window.I18n.locale
      ].js.composer.markmap_sample = ` `;

      api.addComposerToolbarPopupMenuOption({
        icon: "diagram-markmap",
        label: themePrefix("insert_markmap"),
        action: (toolbarEvent) =>
          this.modal.show(OptionsMarkmap, {
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
            this.modal.show(OptionsMarkmap, {
              model: { insertMarkmap: toolbarEvent.applySurround },
            }),
        });
      });

      api.decorateCookedElement((element, helper) => {
        const isPreview = this.markmapManager.isPreview(element);

        if (!helper && !isPreview) {
          return;
        }

        const key = this.markmapManager.uniqueKey(
          isPreview,
          helper?.getModel()
        );
        const attrs = helper?.widget.attrs || {};

        this.markmapManager.applyMarkmaps(element, key, isPreview, attrs);
      });

      api.modifyClass(
        "component:post-text-selection-toolbar",
        postTextSelectionToolbar
      );

      api.cleanupStream(cleanupTableEditButtons);

      // onPageChanged is called the next runloop
      // when decorateCookedElement has already started,
      // so we need an event before that.
      this.router.on("routeDidChange", (transition) => {
        if (transition.isAborted) {
          return;
        }

        this.markmapManager.clear();
        this.markmapInstance.clear();
      });
    });
  }
}

export default {
  name: "discourse-markmap",

  initialize(owner) {
    this.instance = new MarkmapInit(owner);
  },

  tearDown() {
    this.instance = null;
  },
};
