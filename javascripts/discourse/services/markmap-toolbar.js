import { tracked } from "@glimmer/tracking";
import { later, next } from "@ember/runloop";
import Service, { service } from "@ember/service";
import discourseDebounce from "discourse-common/lib/debounce";
import I18n from "discourse-i18n";
import FullscreenMarkmap from "../components/modal/fullscreen-markmap";
import { clsActive, clsToolbarItem, Toolbar } from "../lib/markmap/toolbar";
import { Transformer } from "../lib/markmap/transform";
import { Markmap } from "../lib/markmap/view";
import { defaultOptions } from "../lib/markmap/view/constants";

export default class MarkmapToolbar extends Service {
  @service modal;
  @service markmapInstance;

  @tracked contentDisplayed = false;

  get isContentDisplayed() {
    return this.contentDisplayed;
  }

  insertToolbar(handler, wrapper, attrs = {}) {
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
      title: I18n.t(themePrefix("toolbar.fullscreen")),
      icon: "fullscreen-markmap",
      onClick: () => {
        if (modalElement) {
          if (!document.fullscreenElement) {
            modalElement.querySelector(".d-modal__header").style.display =
              "none";

            modalElement.addEventListener("fullscreenchange", (event) => {
              if (!document.fullscreenElement) {
                event.target.querySelector(".d-modal__header").style.display =
                  "flex";
              }
            });

            modalElement.requestFullscreen();

            modalElement.addEventListener("fullscreenerror", (/*event*/) => {
              // eslint-disable-next-line no-console
              console.error("an error occurred changing into fullscreen");
            });

            this.markmapInstance.lookup(wrapper.dataset.handler)?.fit();
          } else {
            if (document.exitFullscreen) {
              document.exitFullscreen();
              modalElement.querySelector(".d-modal__header").style.display =
                "block";
            }
          }
        } else {
          this.modal.show(FullscreenMarkmap, {
            model: {
              wrapElement: wrapper.previousElementSibling,
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

        wrapper.style.display = "none";

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

            wrapper.style.display = "block";

            wrapElement.style.position = "absolute";
            wrapElement.style.visibility = "hidden";
            wrapElement.style.left = "-9999px";

            wrapElement.querySelector(".mm-toolbar")?.remove();
          },
        });

        toolbarContent.setItems(["show-markmap"]);
      },
    });

    wrapper.insertBefore(el, wrapper.firstChild);

    const items = ["zoomIn", "zoomOut", "fit", "recurse", "fullscreen"];

    if (!modalElement) {
      items.push("separator");
      items.push("show-content");
    }

    toolbar.setItems(items);
  }
}
