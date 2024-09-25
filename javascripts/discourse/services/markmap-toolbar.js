import { tracked } from "@glimmer/tracking";
import Service, { service } from "@ember/service";
import I18n from "discourse-i18n";
import FullscreenMarkmap from "../components/modal/fullscreen-markmap";
import { MARKMAP_COMMENT_REGEX } from "../lib/markmap/html-parser";
import { clsActive, clsToolbarItem, Toolbar } from "../lib/markmap/toolbar";

export default class MarkmapToolbar extends Service {
  @service modal;
  @service markmapInstance;

  @tracked contentDisplayed = false;

  insertToolbar(handler, svgWrapper, attrs = {}) {
    const instance = this.markmapInstance.lookup(handler);
    if (!instance) {
      return;
    }

    const toolbar = Toolbar.create(instance);
    const { el } = toolbar;

    const modalElement = document.querySelector(
      ".d-modal.fullscreen-markmap-modal"
    );

    toolbar.register({
      id: "zoomIn",
      title: I18n.t(themePrefix("toolbar.zoom_in")),
      icon: "zoom-in-markmap",
      onClick: toolbar.getHandler((mm) => mm.rescale(1.25)),
    });

    toolbar.register({
      id: "zoomOut",
      title: I18n.t(themePrefix("toolbar.zoom_out")),
      icon: "zoom-out-markmap",
      onClick: toolbar.getHandler((mm) => mm.rescale(0.8)),
    });

    toolbar.register({
      id: "fit",
      title: I18n.t(themePrefix("toolbar.fit")),
      icon: "fit-markmap",
      onClick: toolbar.getHandler((mm) => mm.fit()),
    });

    toolbar.register({
      id: "recurse",
      title: I18n.t(themePrefix("toolbar.recurse")),
      icon: "recurse-markmap",
      onClick: (e) => {
        const button = e.target.closest(`.${clsToolbarItem}`);
        const active = button?.classList.toggle(clsActive);
        toolbar.markmap?.setOptions({
          toggleRecursively: active,
        });
      },
    });

    toolbar.register({
      id: "fullscreen",
      title: I18n.t(
        themePrefix(
          modalElement ? "toolbar.fullscreen_exit" : "toolbar.fullscreen"
        )
      ),
      icon: modalElement ? "fullscreen-exit-markmap" : "fullscreen-markmap",
      onClick: () => {
        if (modalElement) {
          if (document.exitFullscreen && document.fullscreenElement) {
            document.exitFullscreen();
          }
        } else {
          this.modal.show(FullscreenMarkmap, {
            model: {
              wrapElement: svgWrapper.previousElementSibling,
              attrs,
            },
          });
        }
      },
    });

    toolbar.register({
      id: "show-content",
      title: I18n.t(themePrefix("toolbar.show_content")),
      icon: "content-markmap",
      onClick: () => {
        const wrapElement = document.querySelector(
          `.d-wrap[data-handler="${handler}"]`
        );

        if (!wrapElement) {
          return;
        }

        this.contentDisplayed = true;

        svgWrapper.style.display = "none";

        const regexSource = MARKMAP_COMMENT_REGEX.source;
        const regexFlags = MARKMAP_COMMENT_REGEX.flags;

        wrapElement.innerHTML = wrapElement.innerHTML.replace(
          new RegExp(regexSource, regexFlags + "g"),
          ""
        );

        wrapElement.style.position = "relative";
        wrapElement.style.visibility = "visible";
        wrapElement.style.left = "unset";
        wrapElement.querySelector(".mm-toolbar")?.remove();

        const toolbarContent = Toolbar.create(instance);
        wrapElement.insertBefore(toolbarContent.el, wrapElement.firstChild);

        toolbarContent.register({
          id: "show-markmap",
          title: I18n.t(themePrefix("toolbar.show_markmap")),
          icon: "diagram-markmap",
          onClick: () => {
            this.contentDisplayed = false;

            svgWrapper.style.display = "block";

            wrapElement.style.position = "absolute";
            wrapElement.style.visibility = "hidden";
            wrapElement.style.left = "-9999px";

            wrapElement.querySelector(".mm-toolbar")?.remove();
          },
        });

        toolbarContent.setItems(["show-markmap"]);
      },
    });

    svgWrapper.insertBefore(el, svgWrapper.firstChild);

    const items = ["zoomIn", "zoomOut", "fit", "recurse", "fullscreen"];

    if (!modalElement) {
      items.push("separator");
      items.push("show-content");
    }

    toolbar.setItems(items);
  }
}
